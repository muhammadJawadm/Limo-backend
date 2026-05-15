const cloudinary = require('../config/cloudinary');

/**
 * Uploads a file buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} folder - Optional folder name in Cloudinary
 * @returns {Promise<object>} - Cloudinary upload response
 */
const uploadToCloudinary = (fileBuffer, folder = 'driver_onboarding') => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: 'auto',
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        uploadStream.end(fileBuffer);
    });
};

module.exports = { uploadToCloudinary };
