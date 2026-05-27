const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../db/models');

async function auth(req, res, next) {
  // Get token from header or query param
  let token = '';
  const authHeader = req.header('Authorization');
  if (authHeader) {
    token = authHeader.replace('Bearer ', '');
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;

    // Check if the user still exists and is approved
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    if (!user.approved) {
      return res.status(403).json({ message: 'Your account is pending admin approval' });
    }

    // Attach updated database fields
    req.user.role = user.role;
    req.user.approved = user.approved;
    req.user.name = user.name;
    req.user.phone = user.phone;

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
}

// Middleware to check if user has admin privileges
function isAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Admin privileges required' });
    }
    next();
  });
}

// Middleware to check if user has superadmin privileges
function isSuperAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Super Admin privileges required' });
    }
    next();
  });
}

// Middleware to check if user has teacher/educator or admin/superadmin privileges
function isStaff(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'educator' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Teacher or Admin privileges required' });
    }
    next();
  });
}

module.exports = {
  auth,
  isAdmin,
  isSuperAdmin,
  isStaff
};
