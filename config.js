import { json } from './_auth.js';

export default async () =>
  json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || ''
  });
