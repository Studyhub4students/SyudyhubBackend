const express = require('express');
const router = express.Router();
const { Folder, Document } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   GET api/folders
// @desc    Get all folders (requires auth)
router.get('/', auth, async (req, res) => {
  const { type, parentId } = req.query;
  const query = {};
  
  if (type) query.type = type;
  if (parentId !== undefined) {
    query.parentId = parentId === 'null' ? null : parentId;
  }

  try {
    const folders = await Folder.find(query);
    res.json(folders.map(f => ({
      id: f._id,
      name: f.name,
      type: f.type,
      parentId: f.parentId,
      createdAt: f.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading folders' });
  }
});

// @route   POST api/folders
// @desc    Create a folder (Admin only)
router.post('/', isAdmin, async (req, res) => {
  const { name, type, parentId } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Folder name and type are required' });
  }

  try {
    const folder = new Folder({
      name,
      type,
      parentId: parentId || null
    });
    
    await folder.save();

    res.status(201).json({
      id: folder._id,
      name: folder.name,
      type: folder.type,
      parentId: folder.parentId,
      createdAt: folder.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error creating folder' });
  }
});

// @route   PUT api/folders/:id
// @desc    Update/Rename a folder (Admin only)
router.put('/:id', isAdmin, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Folder name is required' });
  }

  try {
    const updated = await Folder.findByIdAndUpdate(
      req.params.id, 
      { name }, 
      { new: true }
    );
    
    if (!updated) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    res.json({
      id: updated._id,
      name: updated.name,
      type: updated.type,
      parentId: updated.parentId,
      createdAt: updated.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating folder' });
  }
});

// @route   DELETE api/folders/:id
// @desc    Delete folder and cascade delete its contents (Admin only)
router.delete('/:id', isAdmin, async (req, res) => {
  const folderId = req.params.id;

  try {
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Find any subfolders
    const subfolders = await Folder.find({ parentId: folderId });
    const folderIdsToDelete = [folderId, ...subfolders.map(sf => sf._id)];

    // Cascade delete all documents inside any of these folders
    await Document.deleteMany({ folderId: { $in: folderIdsToDelete } });

    // Delete the subfolders and the main folder
    await Folder.deleteMany({ _id: { $in: folderIdsToDelete } });

    res.json({ message: 'Folder and all contents deleted successfully', folderId });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ message: 'Server error deleting folder' });
  }
});

module.exports = router;
