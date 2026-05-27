const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('./config');

const app = express();

// Enable CORS
app.use(cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure public/uploads directory exists
const UPLOADS_DIR = config.UPLOADS_DIR;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve static uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve public static folder if it exists (allows local integrated testing)
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  
  // SPA routing fallback - serve index.html for non-API requests
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// Import routes
const authRoutes = require('./routes/auth');
const folderRoutes = require('./routes/folders');
const documentRoutes = require('./routes/documents');
const announcementRoutes = require('./routes/announcements');

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/announcements', announcementRoutes);

// Seed default data using Mongoose
async function seedDefaultData() {
  try {
    const { User, Folder } = require('./db/models');

    // 1. Seed Permanent Super Admin
    const superAdminPhone = '8218325600';
    const existingSuperAdmin = await User.findOne({ phone: superAdminPhone });
    
    if (!existingSuperAdmin) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('ankit@2004', salt);
      
      const newAdmin = new User({
        name: 'ankit Ghugtyal',
        phone: superAdminPhone,
        password: hashedPassword,
        role: 'superadmin',
        approved: true
      });
      await newAdmin.save();
      console.log('Seeded primary Super Admin account (Phone: 8218325600, Pass: ankit@2004)');
    }

    // 2. Seed Secondary Admin
    const adminPhone = '9999999999';
    const existingAdmin = await User.findOne({ phone: adminPhone });
    
    if (!existingAdmin) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('adminpassword', salt);
      
      const newRegAdmin = new User({
        name: 'Regular Admin',
        phone: adminPhone,
        password: hashedPassword,
        role: 'admin',
        approved: true
      });
      await newRegAdmin.save();
      console.log('Seeded regular Admin account (Phone: 9999999999, Pass: adminpassword)');
    }

    // 3. Seed default subject folders if empty
    // Notes folders
    const notesFoldersCount = await Folder.countDocuments({ type: 'notes' });
    if (notesFoldersCount === 0) {
      const defaultNotes = [
        'Engineering Mathematics',
        'Engineering Physics',
        'Computer Programming',
        'Data Structures'
      ];
      await Folder.insertMany(defaultNotes.map(name => ({ name, type: 'notes', parentId: null })));
      console.log('Seeded default Notes folders');
    }

    // Papers folders
    const papersFoldersCount = await Folder.countDocuments({ type: 'papers' });
    if (papersFoldersCount === 0) {
      const defaultPapers = [
        'Mathematics PYQs',
        'Physics PYQs',
        'Chemistry PYQs',
        'Computer Science PYQs'
      ];
      await Folder.insertMany(defaultPapers.map(name => ({ name, type: 'papers', parentId: null })));
      console.log('Seeded default Papers folders');
    }

    // Lab Manual folders
    const labFoldersCount = await Folder.countDocuments({ type: 'lab_manuals' });
    if (labFoldersCount === 0) {
      const defaultLabs = [
        'Basic Programming Lab',
        'Physics Practical Lab',
        'Data Structures Lab'
      ];
      await Folder.insertMany(defaultLabs.map(name => ({ name, type: 'lab_manuals', parentId: null })));
      console.log('Seeded default Lab Manual folders');
    }

    // Books folders
    const bookFoldersCount = await Folder.countDocuments({ type: 'books' });
    if (bookFoldersCount === 0) {
      const defaultBooks = [
        'Calculus & Algebra',
        'Programming in C',
        'Introduction to Algorithms'
      ];
      await Folder.insertMany(defaultBooks.map(name => ({ name, type: 'books', parentId: null })));
      console.log('Seeded default Book folders');
    }

  } catch (err) {
    console.error('Error during data seeding:', err.message);
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal Server Error' });
});

// Connect to MongoDB & Start Server
mongoose.connect(config.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB successfully.');
    await seedDefaultData();
    
    const PORT = config.PORT;
    app.listen(PORT, () => {
      console.log(`Studyhub Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });
