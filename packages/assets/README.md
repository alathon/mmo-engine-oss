# Setup without external asset repo
- Install [git-lfs](https://git-lfs.com/) and enable for this repository.
- Change the `.gitignore` to re-allow stuff like .glb files.
- Remove the `assets` and `assets:watch` scripts from `package.json`.

# Setup with external asset repo
- Rename `example.env.local` to `.env.local` and edit it with your own values.
