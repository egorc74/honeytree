FROM alpine:3.20
RUN apk add --no-cache postgresql16-client aws-cli tzdata
COPY backup.sh restore.sh test-restore.sh entrypoint.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/entrypoint.sh"]
