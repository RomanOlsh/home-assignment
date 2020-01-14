const  express   = require("express"),
       multer    = require("multer"),
       multerS3  = require("multer-s3"),
       mongojs   = require("mongojs"),
       path      = require("path"),
       AWS       = require("aws-sdk"),
       dotenv    = require("dotenv");
dotenv.config();

const app = express();
const db = mongojs(process.env.MONGO_CONNECTION_STRING, [process.env.MONGO_COLLECTION]);
const port = process.env.PORT || 8080;

AWS.config.update({
    accessKeyId: process.env.AAKI, 
    secretAccessKey: process.env.ASAK, 
    region: process.env.REGION
});

const s3 = new AWS.S3();
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.BUCKET + "/" + Date.now(),
        metadata: function (req, file, cb) {
            cb(null, {fieldName: file.fieldname});
        },
        key: function (req, file, cb) {
            cb(null, path.basename( file.originalname, path.extname( file.originalname ) ) + path.extname( file.originalname ) )
        }
    })
});

app.post("/files/upload", upload.array("files", 7), function (req, res, next) {
    try {
        saveImagesToDB(req.files);
        res.send(req.files);
    } catch(error) {
        console.error(error);
        res.status(400).send("Something went wrong..." + error);
    }
})

function saveImagesToDB(files) {
    files.filter(file => (file.mimetype == "image/jpeg")).forEach(jpeg => {
        db.jpegs.save({
            name: jpeg.originalname,
            size: jpeg.size,
            status: "in process",
            bucket: jpeg.bucket
        }, (err, _) => {
            if (err) {
                console.log("saveImagesToDB: Error while saveing DB object: " + file);
                console.error(err);
            } else {
                console.log("saveImagesToDB: Image: " + jpeg.bucket + "/" + jpeg.originalname + ", saved to DB");
            }
        });
    });
}

const server = app.listen(port, () => console.log("App listening at port: " + port));