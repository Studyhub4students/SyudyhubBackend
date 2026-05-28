const express = require('express');
const router = express.Router();
const { Notification, User, MessageTemplate } = require('../db/models');
const { auth, isAdmin } = require('../middleware/auth');

// @route   POST api/notifications
// @desc    Send a notification to a specific user (Admin only)
router.post('/', isAdmin, async (req, res) => {
  const { recipientId, message } = req.body;

  if (!recipientId || !message) {
    return res.status(400).json({ message: 'Recipient ID and message body are required' });
  }

  try {
    // Verify recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient user not found' });
    }

    // Format the message as requested:
    // From[ADMIN]
    // msg body here
    //
    // Thank you,
    // Studyhub Team.
    const formattedMessage = `From[ADMIN]\n${message.trim()}\n\nThank you,\nStudyhub Team.`;

    const newNotification = new Notification({
      recipientId,
      message: formattedMessage
    });

    await newNotification.save();

    res.status(201).json({
      message: 'Notification sent successfully',
      notificationId: newNotification._id
    });
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ message: 'Server error sending notification' });
  }
});

// @route   GET api/notifications/templates
// @desc    Get all message templates (Admin only)
router.get('/templates', isAdmin, async (req, res) => {
  try {
    const templates = await MessageTemplate.find().sort({ createdAt: 1 });
    res.json(templates.map(t => ({
      id: t._id,
      name: t.name,
      content: t.content,
      createdAt: t.createdAt
    })));
  } catch (err) {
    console.error('Fetch templates error:', err);
    res.status(500).json({ message: 'Server error loading templates' });
  }
});

// @route   POST api/notifications/templates
// @desc    Save a message template (Admin only)
router.post('/templates', isAdmin, async (req, res) => {
  const { name, content } = req.body;

  if (!name || !content) {
    return res.status(400).json({ message: 'Template name and content are required' });
  }

  try {
    // Check if a template with the same name already exists
    const existing = await MessageTemplate.findOne({ name: name.trim() });
    if (existing) {
      existing.content = content.trim();
      await existing.save();
      return res.status(200).json({
        message: 'Template updated successfully',
        templateId: existing._id
      });
    }

    const newTemplate = new MessageTemplate({
      name: name.trim(),
      content: content.trim()
    });

    await newTemplate.save();

    res.status(201).json({
      message: 'Template saved successfully',
      templateId: newTemplate._id
    });
  } catch (err) {
    console.error('Save template error:', err);
    res.status(500).json({ message: 'Server error saving template' });
  }
});

// @route   DELETE api/notifications/templates/:id
// @desc    Delete a message template (Admin only)
router.delete('/templates/:id', isAdmin, async (req, res) => {
  try {
    const deleted = await MessageTemplate.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Template not found' });
    }
    res.json({ message: 'Template deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ message: 'Server error deleting template' });
  }
});

// @route   GET api/notifications/unread
// @desc    Get all unread notifications for the logged-in user
router.get('/unread', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipientId: req.user.id,
      read: false
    }).sort({ createdAt: 1 }); // oldest first or newest? Let's show oldest first or one-by-one

    res.json(notifications.map(n => ({
      id: n._id,
      message: n.message,
      createdAt: n.createdAt
    })));
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ message: 'Server error loading notifications' });
  }
});

// @route   POST api/notifications/read/:id
// @desc    Mark a notification as read (Authenticated recipient only)
router.post('/read/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Ensure the logged-in user is the recipient of the notification
    if (notification.recipientId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: You can only read your own notifications' });
    }

    notification.read = true;
    await notification.save();

    res.json({ message: 'Notification marked as read', id: notification._id });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ message: 'Server error updating notification status' });
  }
});

module.exports = router;
