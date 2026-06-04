const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { fromBuffer } = require("file-type");
const { ImageUploadService } = require("node-upload-images");

async function CatBox(buffer) {
    try {
        const fetchModule = await import("node-fetch");
        const fetch = fetchModule.default;
        const { ext } = await fromBuffer(buffer);
        const form = new FormData();
        form.append("fileToUpload", buffer, `file.${ext}`);
        form.append("reqtype", "fileupload");
        const res = await fetch("https://catbox.moe/user/api.php", {
            method: "POST",
            body: form
        });
        return await res.text();
    } catch {
        return null;
    }
};

async function uploadImageBuffer(buffer) {
    try {
        const service = new ImageUploadService("pixhost.to");
        const { directLink } = await service.uploadFromBinary(buffer, "image.png");
        return directLink || null;
    } catch {
        return null;
    }
}

module.exports = {
    uploadImageBuffer,
    CatBox
};