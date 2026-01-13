const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "src", "profanity", "words.txt");
const destination = path.join(__dirname, "..", "dist", "src", "profanity", "words.txt");

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
