FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# deploy/ is in the build context for the line above; keep it off the site.
RUN rm -rf /usr/share/nginx/html/deploy
EXPOSE 8080
