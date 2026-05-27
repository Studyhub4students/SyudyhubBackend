const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { Document, Announcement } = require('../db/models');
const config = require('../config');
const { auth, isStaff, isAdmin } = require('../middleware/auth');

const getAbsoluteUrl = (req, url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${url}`;
};

// Setup temp directory
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Setup local uploads directory
const UPLOADS_DIR = config.UPLOADS_DIR;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const fileExt = path.extname(file.originalname).toLowerCase();
  if (file.mimetype === 'application/pdf' || fileExt === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF documents are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB Max
});

// Configure Cloudinary if credentials exist
let isCloudinaryConfigured = false;
if (config.CLOUDINARY.cloud_name && config.CLOUDINARY.api_key && config.CLOUDINARY.api_secret) {
  cloudinary.config({
    cloud_name: config.CLOUDINARY.cloud_name,
    api_key: config.CLOUDINARY.api_key,
    api_secret: config.CLOUDINARY.api_secret
  });
  isCloudinaryConfigured = true;
  console.log('Cloudinary successfully configured.');
} else {
  console.log('Cloudinary credentials missing. Falling back to local filesystem storage.');
}

// Helper to delete local file safely
function deleteLocalFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Error deleting file:', filePath, err.message);
  }
}

// @route   GET api/documents
// @desc    Get documents, optional filters by type, folderId, subject, year (requires auth)
router.get('/', auth, async (req, res) => {
  const { type, folderId, subject, year } = req.query;
  const query = {};

  if (type) query.type = type;
  if (folderId) {
    query.folderId = folderId === 'null' ? null : folderId;
  }
  if (subject) query.subject = subject;
  if (year) query.year = year;

  try {
    const documents = await Document.find(query).sort({ createdAt: -1 });
    res.json(documents.map(d => ({
      id: d._id,
      title: d.title,
      type: d.type,
      folderId: d.folderId,
      subject: d.subject,
      year: d.year,
      fileUrl: getAbsoluteUrl(req, d.fileUrl),
      fileName: d.fileName,
      uploadedBy: d.uploadedBy,
      uploadedByUserId: d.uploadedByUserId,
      createdAt: d.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading documents' });
  }
});

// @route   POST api/documents/upload
// @desc    Upload a PDF note/paper/resource (Teacher/Admin only)
router.post('/upload', isStaff, (req, res) => {
  upload.single('pdf')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Multer Error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }

    // Support either direct file URL from frontend OR local file upload
    const { title, type, folderId, subject, year, fileUrl: directFileUrl, fileName: directFileName } = req.body;

    if (!req.file && !directFileUrl) {
      return res.status(400).json({ message: 'Please upload a PDF file or provide a file URL' });
    }

    if (!title || !type) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Title and document type are required' });
    }

    // Validate type
    if (!['notes', 'paper', 'lab_manual', 'book', 'syllabus'].includes(type)) {
      if (req.file) deleteLocalFile(req.file.path);
      return res.status(400).json({ message: 'Invalid document type' });
    }

    try {
      let fileUrl = '';
      let filePublicId = '';

      if (directFileUrl) {
        fileUrl = directFileUrl;
        filePublicId = req.body.filePublicId || '';
      } else if (isCloudinaryConfigured) {
        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: 'studyhub',
          resource_type: 'raw',
          access_mode: 'public'
        });

        fileUrl = uploadResult.secure_url;
        filePublicId = uploadResult.public_id;
        deleteLocalFile(req.file.path); // Delete local temp file
      } else {
        // Move temp file to public/uploads
        const targetPath = path.join(UPLOADS_DIR, req.file.filename);
        fs.renameSync(req.file.path, targetPath);
        fileUrl = `/uploads/${req.file.filename}`;
      }

      // Save record to MongoDB
      const newDoc = new Document({
        title,
        type,
        folderId: folderId && folderId !== 'null' ? folderId : null,
        subject: subject || null,
        year: year || null,
        fileUrl,
        filePublicId,
        fileName: req.file ? req.file.originalname : (directFileName || 'document.pdf'),
        uploadedBy: (req.user.role === 'admin' || req.user.role === 'superadmin')
          ? 'Admin'
          : (req.user.role === 'educator'
            ? (req.user.name.toLowerCase().startsWith('teacher') ? `${req.user.name} (Educator)` : `Teacher ${req.user.name} (Educator)`)
            : (req.user.name || 'Staff Member')),
        uploadedByUserId: req.user.id
      });
      
      await newDoc.save();

      // Automatically create an announcement
      try {
        const displayType = type === 'notes' ? 'Notes' : (type === 'paper' ? 'PYQ/Paper' : (type === 'lab_manual' ? 'Lab Manual' : (type === 'book' ? 'Book' : 'Syllabus')));
        const uploaderName = (req.user.role === 'admin' || req.user.role === 'superadmin')
          ? 'Admin'
          : (req.user.role === 'educator'
            ? (req.user.name.toLowerCase().startsWith('teacher') ? `${req.user.name} (Educator)` : `Teacher ${req.user.name} (Educator)`)
            : (req.user.name || 'Staff Member'));
        const annTitle = `New ${displayType} Uploaded`;
        const annContent = `"${title}" has been uploaded by ${uploaderName}. Click here to open and view the document.`;
        
        const announcement = new Announcement({
          title: annTitle,
          content: annContent,
          docUrl: fileUrl
        });

        await announcement.save();

        // Limit announcements to 10 max
        const count = await Announcement.countDocuments();
        if (count > 10) {
          const oldest = await Announcement.find().sort({ createdAt: 1 }).limit(count - 10);
          const idsToDelete = oldest.map(a => a._id);
          await Announcement.deleteMany({ _id: { $in: idsToDelete } });
        }
      } catch (annErr) {
        console.error('Failed to create automatic announcement:', annErr);
      }

      res.status(201).json({
        id: newDoc._id,
        title: newDoc.title,
        type: newDoc.type,
        folderId: newDoc.folderId,
        subject: newDoc.subject,
        year: newDoc.year,
        fileUrl: getAbsoluteUrl(req, newDoc.fileUrl),
        fileName: newDoc.fileName,
        uploadedBy: newDoc.uploadedBy,
        uploadedByUserId: newDoc.uploadedByUserId,
        createdAt: newDoc.createdAt
      });
    } catch (uploadErr) {
      console.error('File storage/upload error:', uploadErr);
      deleteLocalFile(req.file.path);
      res.status(500).json({ message: uploadErr.message || 'Failed to process and store file' });
    }
  });
});

// @route   GET api/documents/my-uploads
// @desc    Get all documents uploaded by the authenticated user (Educator/Admin only)
router.get('/my-uploads', isStaff, async (req, res) => {
  try {
    const documents = await Document.find({ uploadedByUserId: req.user.id }).sort({ createdAt: -1 });
    res.json(documents.map(d => ({
      id: d._id,
      title: d.title,
      type: d.type,
      folderId: d.folderId,
      subject: d.subject,
      year: d.year,
      fileUrl: getAbsoluteUrl(req, d.fileUrl),
      fileName: d.fileName,
      uploadedBy: d.uploadedBy,
      uploadedByUserId: d.uploadedByUserId,
      createdAt: d.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading your documents' });
  }
});

// @route   GET api/documents/download/:id
// @desc    Download a document directly (forces attachment headers)
router.get('/download/:id', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const fileUrl = doc.fileUrl;
    const fileName = doc.fileName || 'document.pdf';

    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // Cloudinary URL or external URL
      // Stream the file to force direct download
      const response = await fetch(fileUrl);
      if (!response.ok) {
        return res.status(500).json({ message: 'Failed to retrieve file from storage provider' });
      }
      
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/pdf');
      
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } else {
      // Local file
      const filePath = path.join(UPLOADS_DIR, fileUrl.replace('/uploads/', ''));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'File not found on local disk' });
      }
      return res.download(filePath, fileName);
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Server error downloading document' });
  }
});

// @route   PUT api/documents/:id
// @desc    Update a document's metadata (Uploader or Admin only)
router.put('/:id', isStaff, async (req, res) => {
  const { title, subject, year } = req.body;
  
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Check permissions: Educators can only edit their own uploaded documents. Admins/Superadmins can edit any document.
    if (req.user.role === 'educator' && (!document.uploadedByUserId || document.uploadedByUserId.toString() !== req.user.id)) {
      return res.status(403).json({ message: 'Access denied: You can only edit documents that you uploaded' });
    }
    
    if (title) document.title = title;
    if (subject !== undefined) document.subject = subject;
    if (year !== undefined) document.year = year;
    
    await document.save();
    
    res.json({
      id: document._id,
      title: document.title,
      type: document.type,
      folderId: document.folderId,
      subject: document.subject,
      year: document.year,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      uploadedBy: document.uploadedBy,
      uploadedByUserId: document.uploadedByUserId,
      createdAt: document.createdAt
    });
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ message: 'Server error updating document' });
  }
});

// @route   DELETE api/documents/:id
// @desc    Delete a document (Uploader or Admin only)
router.delete('/:id', isStaff, async (req, res) => {
  const docId = req.params.id;

  try {
    const document = await Document.findById(docId);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Check permissions: Educators can only delete their own uploaded documents. Admins/Superadmins can delete any document.
    if (req.user.role === 'educator' && (!document.uploadedByUserId || document.uploadedByUserId.toString() !== req.user.id)) {
      return res.status(403).json({ message: 'Access denied: You can only delete documents that you uploaded' });
    }

    // Delete file from Cloudinary if applicable
    if (isCloudinaryConfigured && document.filePublicId) {
      const resourceType = document.fileUrl.includes('/raw/') ? 'raw' : 'image';
      await cloudinary.uploader.destroy(document.filePublicId, { resource_type: resourceType });
    } else if (!isCloudinaryConfigured && document.fileUrl.startsWith('/uploads/')) {
      // Delete local file
      const fileName = path.basename(document.fileUrl);
      const filePath = path.join(UPLOADS_DIR, fileName);
      deleteLocalFile(filePath);
    }

    await Document.findByIdAndDelete(docId);
    res.json({ message: 'Document deleted successfully', docId });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ message: 'Server error deleting document' });
  }
});

module.exports = router;
