# Mr Nobody Video Editing Portfolio — Client + Admin

## Public client link
Open the root URL of the Netlify site:
`https://YOUR-SITE.netlify.app/`

Clients only see the public video-editing portfolio. There is no Admin button/link on the public page.

## Private admin link
`https://YOUR-SITE.netlify.app/admin`

The `/admin` route loads the admin login page. The admin page is also marked `noindex,nofollow` so search engines should not index it.

## Netlify deployment
Upload/replace the COMPLETE repository contents, including:
- `index.html`
- `admin.html`
- `netlify.toml`
- `netlify/functions/`
- `package.json`

Do not upload only `index.html` if you want the admin/backend to work.

## Environment variables
Set these in Netlify:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `CLOUDINARY_CLOUD_NAME` (for uploads)
- `CLOUDINARY_UPLOAD_PRESET` (for uploads)

The public site does not expose these credentials.
