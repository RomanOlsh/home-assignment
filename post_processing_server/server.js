const express    = require("express"),
      mongojs    = require("mongojs"),
      rateLimit  = require("express-rate-limit"),
      crcLib     = require("crc"),
      request    = require("request"),
      each       = require("async/each"),
      bodyParser = require("body-parser"),
      AWS        = require("aws-sdk"),
      dotenv     = require("dotenv");
dotenv.config();

let messageMapper = {};
const app = express();
const db = mongojs(process.env.MONGO_CONNECTION_STRING, [process.env.MONGO_COLLECTION]);
const port = process.env.PORT || 8082; 
const limiter = rateLimit({ windowMs: 1000, max: 5 });

AWS.config.update({
    accessKeyId: process.env.AAKI, 
    secretAccessKey: process.env.ASAK, 
    region: process.env.REGION
});

const s3  = new AWS.S3();
const sns = new AWS.SNS();
const snsConfig = {
    Protocol: process.env.SNS_PROTOCOL,
    TopicArn: process.env.SNS_TOPIC,
    Attributes: {},
    Endpoint: process.env.SNS_ENDPOINT,
    ReturnSubscriptionArn: true
};
sns.subscribe(snsConfig, (subscribeError, subscribeData) => {
    if (subscribeError) console.log(subscribeError, subscribeError.stack);
    else console.log(subscribeData);
});

// Handels incomming SNS messages: "SubscriptionConfirmation" and "Notification":
function snsHandleMessage(req, resp, next) {
    try {
          let payloadStr = req.body;
          payload = JSON.parse(payloadStr);

          if (req.header("x-amz-sns-message-type") === "SubscriptionConfirmation") {
              const url = payload.SubscribeURL;
              request(url, function (error, response) {
                if (!error && response.statusCode == 200) console.log("handleSNSMessage: Confirmed");
                else {
                    console.error(error);
                    throw new Error(`handleSNSMessage: Unable to subscribe to given URL`);
                }
            });
          } else if (req.header("x-amz-sns-message-type") === "Notification") orchestrate(payload);
            else throw new Error(`handleSNSMessage: Invalid message type ${payload.Type}`);
      } catch (err) {
          console.error(err);
          resp.status(500).send("handleSNSMessage: Internal server error " + err);
      }
      resp.send("Ok");
}

// Receive all 7 notifications, find JSON with assignments and run post-processing:
function orchestrate(message) {
    try {
        let json     = JSON.parse(message["Message"]);
        let bucket   = json["Records"][0]["s3"]["bucket"]["name"];
        let folder   = json["Records"][0]["s3"]["object"]["key"].split("/")[0];
        let fileName = json["Records"][0]["s3"]["object"]["key"].split("/")[1];

        if (!messageMapper.hasOwnProperty(folder)) messageMapper[folder] = [];

        messageMapper[folder].push(fileName);

        if (messageMapper[folder].length == 7) filterJsonsAndStartPostProcessing({bucket: bucket+ "/" + folder, files: messageMapper[folder]});
    } catch (error) {
        console.log("orchestrate: Error while parsing SNS message");
        console.error(error)
    }
}
 
function filterJsonsAndStartPostProcessing(payload) {
    let jsonFiles = payload.files.filter(file => file.includes("json"));
    s3.getObject({Bucket: payload.bucket, Key: jsonFiles[0]}, (readFirstJsonError, firstJsonResponse) => {
        if (!readFirstJsonError) {
            let firstJsonBody = JSON.parse(firstJsonResponse.Body);
            s3.getObject({Bucket: payload.bucket, Key: jsonFiles[1]}, (readSecondJsonError, secondJsonResponse) => {
                if (!readSecondJsonError) {
                    let secondJsonBody  = JSON.parse(secondJsonResponse.Body);
                    let firstJson  = (firstJsonBody.length == 5) ? firstJsonBody : secondJsonBody;
                    let secondJson = (firstJsonBody.length > 5) ? firstJsonBody : secondJsonBody;
                    firstJson.forEach(file => postProcessing({file: file, bucket: payload.bucket, secondJson: secondJson}));
                }
                else {
                    console.log("filterJsonsAndStartPostProcessing: Failed to read JSON #2 from S3");
                    console.error(readSecondJsonError);
                }
            });
        }
        else {
            console.log("filterJsonsAndStartPostProcessing: Failed to read JSON#1 from S3");
            console.error(readFirstJsonError);
        }
    });
}

function postProcessing(payload) {
    console.log("postProcessing: Starting for file: " + payload.file.name);
    
    db.jpegs.findOne({name: payload.file.name, bucket: payload.bucket}, (err, jpeg) => {
        if (err == null && jpeg != null) {
            
            s3.getObject({ Bucket: jpeg.bucket, Key: jpeg.name }, (readFileFromS3Err, data) => {
                if (readFileFromS3Err) {
                    console.log("postProcessing: Failed to read a file from S3: " + jpeg.filename + ", err: " + readFileFromS3Err);
                    throw readFileFromS3Err;
                }
                else {
                    // CRC
                    let jpegCrc = crcLib.crc32(data.Body).toString(16);
                    let crcStatus = (payload.file.crc == jpegCrc) ? "good" : "bad";

                    console.log("postProcessing: Updating CRC comparison result, calculated crc: " + jpegCrc + ", given: " + payload.file.crc);
                    db.jpegs.update({name: payload.file.name, bucket: payload.bucket}, { $set: {status: crcStatus}}, (updateCrcErr, _) => {
                        
                        // Byte sum:
                        if (updateCrcErr == null) {
                            let byteArray = new Uint8Array(data.Body);
                            let byteArraySum = byteArray.reduce((a, b) => a + b);
                            let byteSumStatus = (byteArraySum == payload.file.byteSum) ? "good" : "bad";
                            
                            console.log("postProcessing: Updating ByteSum comparison result, calculated byteArraySum: " + byteArraySum + ", given: " + payload.file.byteSum);
                            db.jpegs.update({name: payload.file.name, bucket: payload.bucket}, { $set: {status: byteSumStatus}}, (updateByteSumErr, _) => {

                                // Size:
                                if (updateByteSumErr == null) {
                                    let fileSizeStatus = (jpeg.size == payload.file.size) ? "good" : "bad";

                                    console.log("postProcessing: Updating Size comparison result, calculated size: " + jpeg.size + ", given: " + payload.file.size);
                                    db.jpegs.update({name: payload.file.name, bucket: payload.bucket}, { $set: {status: fileSizeStatus}}, (updateSizeErr, _) => {

                                        // Call DataServer:
                                        if (updateSizeErr == null) {
                                            console.log("postProcessing: Calling DataServer");
                                            request(process.env.DATA_SERVER_URL, (dataServerErr, response, body) => {
                                                let dataServerStatus = (dataServerErr == null && response.statusCode == "200") ? "good" : "bad";

                                                console.log("postProcessing: Updating file with DataServer call response, dataServerStatus: " + dataServerStatus);
                                                db.jpegs.update({name: payload.file.name, bucket: payload.bucket}, { $set: {status: dataServerStatus}}, (updateDataServerStatusErr, _) => {

                                                    // Call all 10 api from j2 and update to "good":
                                                    if (updateDataServerStatusErr == null) {
                                                        console.log("postProcessing: Requesting JSON #2 URLs");
                                                        each(payload.secondJson, requestActionFromSecondJson, (requestAllErr) => {
                                                            if(requestAllErr) {
                                                                console.log("postProcessing: Request all URL from JSON # 2 failed");
                                                                console.error(requestAllErr);
                                                            } else {
                                                                console.log("postProcessing: Finished with requesting JSON #2 URLs, updating file with 'good' status");
                                                                db.jpegs.update({name: payload.file.name, bucket: payload.bucket}, { $set: {status: "good"}}, (updateJ2StatusErr, _) => {
                                                                    if (updateJ2StatusErr) {
                                                                        console.log("postProcessing: Failed to update status after making JSON #2 requests");
                                                                        console.error(updateJ2StatusErr);
                                                                    }
                                                                });
                                                            }
                                                        });
                                                    } else {
                                                        console.log("postProcessing: Failed to update status according to DataServer call response");
                                                        console.error(updateDataServerStatusErr);
                                                    }
                                                });
                                            });
                                        } else {
                                            console.log("postProcessing: Failed to update status according to file size comparison result");
                                            console.error(updateSizeErr);
                                        }
                                    });
                                } else {
                                    console.log("postProcessing: Failed to update status according to Byte sum comparison result");
                                    console.error(updateByteSumErr);
                                }
                            });
                        } else {
                            console.log("postProcessing: Failed to update status according to CRC comparison result");
                            console.error(updateCrcErr);
                        }
                    });
                }
              });
        } else {
            console.log("postProcessing: Failed for payload: " + payload);
            console.error(err);
        }
    });

}

function requestActionFromSecondJson(entry, callback) {
    console.log("requestActionFromSecondJson: Starting with entry: " +  JSON.stringify(entry));
    request.post(entry.url, entry.payload, (error, response, _) => {
        if (error) {
            console.log("requestActionFromSecondJson: Failed request with URL: " + entry.url);
            console.error(error);
        }
        else console.log("requestActionFromSecondJson: Response code: " + response.statusCode);

        callback();
    });
}

// Handle SNS upcomming message:
app.post("/", bodyParser.text(), snsHandleMessage);

// Get number of files in the system:
app.get("/api/files/size", function (_, res) {
        db.jpegs.find().count((err, count) => {
            if (err) res.status(500).send({err: JSON.stringify(err)});
            else res.status(200).send("Number of files in the system: " + count);
        });
});

// Get all files in the system:
app.get("/api/files", function (_, res) {
    db.jpegs.find({}, {bucket: 0}, (err, docs) => {
        if (err) res.status(500).send({err: JSON.stringify(err)});
        else res.status(200).send(docs);
    });
});

// Delete all docs on DB and empties messageMapper:
app.get("/api/files/clear", function (_, res) {
    messageMapper = {};
    db.jpegs.drop((err, delOK) => {
        if (err) res.status(500).send({err: JSON.stringify(err)});
        else res.status(200).send(delOK);
    });
});

// Get file’s name, size and status:
app.get("/api/files/:id", function (req, res) {
    db.jpegs.findOne({_id: mongojs.ObjectId(req.params.id)}, (err, doc) => {
        if (err || null === doc) {
            console.log("Failed to find a file with id: " + req.params.id);
            res.status(500).send({
                reson: "Double check your id",
                err: JSON.stringify(err)
            });
        } else {
            console.log("Found file with id: " + req.params.id);
            res.status(200).send({
                name: doc.name,
                size: doc.size,
                status: doc.status
            });
        }
    });
});

// Apply limiter:
app.use("/api/", limiter);

const server = app.listen(port, () => console.log("App listening at port: " + port));