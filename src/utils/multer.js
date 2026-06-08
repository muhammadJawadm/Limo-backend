const multer = require('multer');

const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
];

const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only images (JPEG, PNG, GIF, WebP) and PDF files are allowed'), false);
    }
};

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
    },
    fileFilter,
});

module.exports = upload;
