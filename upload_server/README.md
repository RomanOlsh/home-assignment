# Heroku Deploy
 - heroku login
 - heroku container:login
 - docker build -t web .
 - heroku container:push web --app file-uploader-server-app
 - heroku container:release web --app file-uploader-server-app

# .env file should include:
## MONGO DB:
* MONGO_CONNECTION_STRING=******
* MONGO_COLLECTION=******

## AWS:
* AAKI=****** (accessKeyId)
* ASAK=****** (secretAccessKey)
* REGION=******
* BUCKET=******
