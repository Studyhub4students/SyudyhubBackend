const express = require('express');
const router = express.Router();
const { HelpRequest } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   POST api/help
// @desc    Submit a help and support request (Teachers and Students)
router.post('/', auth, async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' });
  }

  try {
    const newRequest = new HelpRequest({
      userId: req.user.id,
      name: req.user.name,
      phone: req.user.phone,
      role: req.user.role,
      subject,
      message
    });

    await newRequest.save();

    res.status(201).json({
      id: newRequest._id,
      userId: newRequest.userId,
      name: newRequest.name,
      phone: newRequest.phone,
      role: newRequest.role,
      subject: newRequest.subject,
      message: newRequest.message,
      status: newRequest.status,
      createdAt: newRequest.createdAt
    });
  } catch (err) {
    console.error('Submit help request error:', err);
    res.status(500).json({ message: 'Server error submitting help request' });
  }
});

// @route   GET api/help
// @desc    Get all help and support requests (Admin and Superadmin only)
router.get('/', isAdmin, async (req, res) => {
  try {
    const list = await HelpRequest.find().sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id,
      userId: r.userId,
      name: r.name,
      phone: r.phone,
      role: r.role,
      subject: r.subject,
      message: r.message,
      status: r.status,
      createdAt: r.createdAt
    })));
  } catch (err) {
    console.error('Load help requests error:', err);
    res.status(500).json({ message: 'Server error loading help requests' });
  }
});

// @route   POST api/help/resolve/:id
// @desc    Mark a help request as resolved (Admin and Superadmin only)
router.post('/resolve/:id', isAdmin, async (req, res) => {
  try {
    const request = await HelpRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    request.status = request.status === 'resolved' ? 'pending' : 'resolved';
    await request.save();

    res.json({ message: `Request marked as ${request.status}`, id: request._id, status: request.status });
  } catch (err) {
    console.error('Resolve help request error:', err);
    res.status(500).json({ message: 'Server error updating request' });
  }
});

// @route   DELETE api/help/:id
// @desc    Delete a help request (Admin and Superadmin only)
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const deleted = await HelpRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Request not found' });
    }
    res.json({ message: 'Help request deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete help request error:', err);
    res.status(500).json({ message: 'Server error deleting request' });
  }
});

module.exports = router;
