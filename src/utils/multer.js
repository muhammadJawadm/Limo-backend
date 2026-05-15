const multer = require('multer');

// Use memory storage to avoid saving files to disk before uploading to Cloudinary
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

module.exports = upload;
