# Desktop Update Publishing

Bug Pocket uses `electron-updater` with an S3-backed `electron-builder` publish target.

Required repository secrets:

- `BUG_POCKET_UPDATES_BUCKET`: `bug-pocket-updates-v1` for the production Windows update feed.
- `AWS_REGION`: bucket region.
- `AWS_ACCESS_KEY_ID`: CI-only IAM access key.
- `AWS_SECRET_ACCESS_KEY`: CI-only IAM secret.

Bucket access rules:

- Public users must be able to read generated installer/update objects with `s3:GetObject`.
- Only the CI IAM identity should be able to write objects with `s3:PutObject`.
- Publish artifacts are written under the `windows/` prefix, including `latest.yml`.

Example public read bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadUpdates",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::bug-pocket-updates-v1/windows/*"
    }
  ]
}
```

Example CI write IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WriteBugPocketUpdates",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:PutObjectAcl"],
      "Resource": "arn:aws:s3:::bug-pocket-updates-v1/windows/*"
    }
  ]
}
```

Run `npm run dist:publish` from CI to build the NSIS installer and publish the generated artifacts plus `latest.yml`.

