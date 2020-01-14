# Heroku Deploy
heroku login
heroku container:login
docker build -t web .
heroku container:push web --app data-server-simulator
heroku container:release web --app data-server-simulator