# Route 1: from the build archive

The archive holds the build tool and every type's libraries: nothing to install or fetch, for any
type. Find it in the folder the chat keeps attachments in
(`find / -name 'h5p-author-build*.tar.gz' 2>/dev/null`), unpack it in your working folder and
build:

```bash
tar -xzf <archive>   # or: python3 -m tarfile -e <archive> .
node h5p-author.mjs build source.json course.h5p --libraries parts
```

With no network, a file's `path` must name a file here, such as one the user attached.
