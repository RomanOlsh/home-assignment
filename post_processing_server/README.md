# Heroku Deploy
* heroku login
* heroku container:login
* docker build -t web .
* heroku container:push web --app post-processing-server
* heroku container:release web --app post-processing-server

# .env file should include:
## MONGO DB:
* MONGO_CONNECTION_STRING=******
* MONGO_COLLECTION=******

## AWS:
* AAKI=****** (accessKeyId)
* ASAK=****** (secretAccessKey)
* REGION=******
* BUCKET=******

## AWS SNS:
* SNS_ENDPOINT=******
* SNS_TOPIC=******
* SNS_PROTOCOL=******

## DATA-SERVER:
* DATA_SERVER_URL=******
