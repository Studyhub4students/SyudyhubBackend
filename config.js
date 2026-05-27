require('dotenv').config();
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'studyhubsecretkey987654321',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studyhub',
  CLOUDINARY: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
  },
  UPLOADS_DIR: path.join(__dirname, 'uploads')
};
