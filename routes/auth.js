const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Document } = require('../db/models');
const config = require('../config');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');

// @route   POST api/auth/signup
// @desc    Register user (instant approval for student, admin approval for educator/admin)
router.post('/signup', async (req, res) => {
  const { name, phone, password, role } = req.body;

  // Simple validation
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  // Check if role is valid
  if (!['student', 'educator', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user role selection' });
  }

  try {
    // Check for existing user
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Students are approved automatically. Educators & Admins require admin approval.
    const approved = role === 'student';

    const newUser = new User({
      name,
      phone,
      password: hashedPassword,
      role,
      approved
    });
    
    await newUser.save();

    if (!approved) {
      return res.status(201).json({
        message: 'Registration successful! Your account is pending admin approval before you can log in.',
        requiresApproval: true
      });
    }

    // Sign JWT for students (never expires)
    const token = jwt.sign(
      { id: newUser._id, role: newUser.role, approved: newUser.approved },
      config.JWT_SECRET
    );

    res.status(201).json({
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        phone: newUser.phone,
        role: newUser.role,
        approved: newUser.approved
      }
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  // Simple validation
  if (!phone || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    // Check for existing user
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if approved
    if (!user.approved) {
      return res.status(403).json({ message: 'Your account is pending admin approval' });
    }

    // Sign JWT (never expires)
    const token = jwt.sign(
      { id: user._id, role: user.role, approved: user.approved },
      config.JWT_SECRET
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        approved: user.approved
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET api/auth/me
// @desc    Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      approved: user.approved
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET api/auth/pending
// @desc    Get all users pending approval (Admin only)
router.get('/pending', isAdmin, async (req, res) => {
  try {
    const pendingUsers = await User.find({ approved: false }).select('-password');
    res.json(pendingUsers.map(u => ({
      id: u._id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      approved: u.approved,
      createdAt: u.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading pending list' });
  }
});

// @route   POST api/auth/approve/:id
// @desc    Approve a pending registration (Admin only)
router.post('/approve/:id', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const updated = await User.findByIdAndUpdate(userId, { approved: true }, { new: true });
    
    if (!updated) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `Approved user ${updated.name}`, userId });
  } catch (err) {
    res.status(500).json({ message: 'Server error during approval' });
  }
});

// @route   POST api/auth/reject/:id
// @desc    Reject and delete a pending registration (Admin only)
router.post('/reject/:id', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const deleted = await User.findByIdAndDelete(userId);
    
    if (!deleted) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `Rejected and removed user account`, userId });
  } catch (err) {
    res.status(500).json({ message: 'Server error during rejection' });
  }
});

// @route   GET api/auth/users
// @desc    Get all registered users (Admin only)
router.get('/users', isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    const result = [];
    for (const u of users) {
      let points = undefined;
      if (u.role === 'educator') {
        const uploadsCount = await Document.countDocuments({ uploadedByUserId: u._id });
        const docs = await Document.find({ uploadedByUserId: u._id });
        let likesCount = 0;
        docs.forEach(doc => {
          if (doc.likes) likesCount += doc.likes.length;
        });
        points = (uploadsCount * 2) + likesCount;
      }
      result.push({
        id: u._id,
        name: u.name,
        phone: u.phone,
        role: u.role,
        approved: u.approved,
        points,
        createdAt: u.createdAt
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE api/auth/users/:id
// @desc    Delete any user (Super Admin can delete anyone, Admin can only delete students)
router.delete('/users/:id', isAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Permanent Super Admin protection
    if (userToDelete.phone === '8218325600') {
      return res.status(400).json({ message: 'Cannot delete the primary Super Admin account' });
    }

    // Can't delete self
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Staff (educators, admins, superadmins) can only be deleted by Super Admins
    if (['admin', 'superadmin', 'educator'].includes(userToDelete.role)) {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied: Only Super Admin can delete admin or teacher accounts' });
      }
    }

    await User.findByIdAndDelete(userId);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST api/auth/promote/:id
// @desc    Promote an Admin to Super Admin (Super Admin only)
router.post('/promote/:id', isSuperAdmin, async (req, res) => {
  const targetId = req.params.id;

  try {
    const userToPromote = await User.findById(targetId);
    if (!userToPromote) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (userToPromote.role !== 'admin') {
      return res.status(400).json({ message: 'Only Admin accounts can be promoted to Super Admin' });
    }

    const updated = await User.findByIdAndUpdate(targetId, { role: 'superadmin' }, { new: true });
    res.json({ message: `Successfully promoted ${updated.name} to Super Admin`, userId: targetId });
  } catch (err) {
    res.status(500).json({ message: 'Server error promoting user' });
  }
});

// @route   GET api/auth/teachers/ranking
// @desc    Get all enrolled teachers with ranks and points (requires auth)
router.get('/teachers/ranking', auth, async (req, res) => {
  try {
    const teachers = await User.find({ role: 'educator', approved: true }).select('name phone createdAt');
    const rankingList = [];

    for (const t of teachers) {
      const uploadsCount = await Document.countDocuments({ uploadedByUserId: t._id });
      const docs = await Document.find({ uploadedByUserId: t._id });
      let likesCount = 0;
      docs.forEach(doc => {
        if (doc.likes) likesCount += doc.likes.length;
      });

      const points = (uploadsCount * 2) + likesCount;
      rankingList.push({
        id: t._id,
        name: t.name,
        phone: t.phone,
        uploads: uploadsCount,
        likes: likesCount,
        points,
        createdAt: t.createdAt
      });
    }

    // Sort by points descending, then by name
    rankingList.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      return a.name.localeCompare(b.name);
    });

    res.json(rankingList);
  } catch (err) {
    console.error('Ranking endpoint error:', err);
    res.status(500).json({ message: 'Server error loading rankings' });
  }
});

// @route   GET api/auth/teachers/stats
// @desc    Get teacher analytics statistics (requires auth)
router.get('/teachers/stats', auth, async (req, res) => {
  try {
    // Total files uploaded by all educators
    const educators = await User.find({ role: 'educator' }).select('_id');
    const educatorIds = educators.map(e => e._id);
    const totalTeacherFiles = await Document.countDocuments({ uploadedByUserId: { $in: educatorIds } });

    // Files uploaded by self
    const ownFilesCount = await Document.countDocuments({ uploadedByUserId: req.user.id });

    // Total likes on self's resources
    const ownDocs = await Document.find({ uploadedByUserId: req.user.id });
    let ownLikesCount = 0;
    ownDocs.forEach(doc => {
      if (doc.likes) ownLikesCount += doc.likes.length;
    });

    res.json({
      totalTeacherFiles,
      ownFilesCount,
      ownLikesCount
    });
  } catch (err) {
    console.error('Stats endpoint error:', err);
    res.status(500).json({ message: 'Server error loading teacher stats' });
  }
});

module.exports = router;
