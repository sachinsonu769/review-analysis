# Run the Windows Docker bundle

The Windows bundle includes the application image, source, Compose configuration, and launchers. It runs the browser UI and analyzers inside Linux containers. Host Node.js, npm, Java, Git, and Python installations are unnecessary for the bundled launch.

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and start its Linux container engine. Follow Docker's current Windows/WSL requirements.
2. Extract the complete bundle. Keep `review-analysis-image.tar.gz`, `compose.yaml`, and `scripts/` in their supplied layout.
3. Double-click `scripts\windows\start.cmd`. It loads the bundled image, waits for `/health`, and opens `http://127.0.0.1:8787`.
4. Use `scripts\windows\health.cmd` to print the health response, and `scripts\windows\stop.cmd` to stop the app.

The launcher also works after the image is already loaded if the archive is absent. An incomplete bundle with neither archive nor loaded image produces a clear error. `docker load` accepts the gzip-compressed image archive directly. [Docker image loading](https://docs.docker.com/reference/cli/docker/image/load/)

Docker Desktop installation needs internet access. Once Desktop and the included image are installed, bundled fixture analysis can run offline; the launcher uses `pull_policy: never` and never downloads a substitute image. Source builds still need internet access for official images, Debian packages, the npm lockfile dependencies, and PMD.

## Runtime boundaries

Compose runs `review-analysis:0.2.0` for `linux/amd64` as UID/GID 1000, with a read-only root filesystem, a writable 512 MiB `/tmp`, dropped capabilities, and no privilege escalation. The published port binds only to host `127.0.0.1:8787`. Temporary analyzer copies and caches are disposable. The image contains the UI, source engine, bundled fixtures, Node 24, Java 21, Git, and trusted PMD 7.17.0. [Compose service settings](https://docs.docker.com/reference/compose-file/services/)

The default demo uses supplied source fixtures. Analysis is advisory and source-only; no examined project is installed, built, executed, modified, or sent to an external AI service. No deployment, repository push, or human approval occurs. Stop/restart clears temporary container data; save any desired report downloads before stopping.

If port 8787 is already occupied, stop the competing local service or deliberately change the host port in `compose.yaml` and the launcher/browser address together. If startup fails, the launcher prints the app's last 30 log lines. Docker Desktop must be running in Linux-container mode.

## Optional authorized repository mount

To inspect additional sources, create `compose.override.yaml` beside `compose.yaml` with an explicitly authorized directory mounted read-only. Compose automatically includes this override when the launchers run:

```yaml
services:
  app:
    volumes:
      - type: bind
        source: 'C:\Users\you\Projects\authorized-repository'
        target: /inputs/repository
        read_only: true
        bind:
          create_host_path: false
```

Replace the example with a real existing directory. Use container paths such as `/inputs/repository` in workspace snapshot settings. The server permits bundled fixtures and configured `/inputs` roots; it does not gain access to unmounted host directories. The runtime user must have read access. For separate repositories, add separate read-only mounts under `/inputs` and provide explicit workspace mappings. The application does not infer cross-repository ownership or runtime links.

For a CLI review from the bundle directory, run the CLI inside the existing app container with container paths and a rules file within the authorized mount:

```cmd
docker compose exec -T app node src/cli.js analyze --baseline /inputs/repository/baseline --candidate /inputs/repository/candidate --rules /inputs/repository/rules.json --as-of 2026-10-11 --format readable
```

Use the intended analysis date. The example compares two source directories; exact Git revisions require the CLI's repository/revision options. Cache and report destinations must remain outside examined roots, for example under `/tmp`.

## Build and export from source

On a Linux/macOS builder with Docker and Bash, run from the source root:

```sh
bash scripts/container/build-image.sh
bash scripts/container/export-image.sh /path/to/bundle/review-analysis-image.tar.gz
```

The first command builds the application and compiles `app/*.ts` into `app-dist` using the pinned TypeScript dependency. It installs lockfile dependencies with `npm ci --omit=dev --ignore-scripts`. The exporter creates the gzip archive, an `.image-id` record, and an archive `.sha256` file. Keep the archive in the bundle root for the Windows launcher. Export uses `docker save`; this is an image archive, not a filesystem-only `docker export`.

The builder forwards optional HTTP/HTTPS proxy settings. If the build network requires a trusted custom certificate bundle, set `REVIEW_ANALYSIS_BUILD_CA_FILE` to its path. It is mounted as a BuildKit secret for HTTPS downloads and npm installation; TLS verification stays enabled and the bundle is not copied into the runtime image.

The Dockerfile pins these official image manifest digests:

| Input | Digest |
| --- | --- |
| [Node `24-bookworm-slim`](https://hub.docker.com/_/node) | `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20` |
| [Eclipse Temurin `21-jre-jammy`](https://hub.docker.com/_/eclipse-temurin) | `sha256:f04fb34e053148344e83317976114ec3f37e4b830ec8bdab5a2fe3cecd7d010b` |

PMD comes from the [official 7.17.0 release](https://github.com/pmd/pmd/releases/tag/pmd_releases/7.17.0), file `pmd-dist-7.17.0-bin.zip`. Its published SHA256 is:

```text
440f6855769c1a651cebd735133cba188df077881af31bd923766b869482bebd
```

The checksum is published with the [official release assets](https://github.com/pmd/pmd/releases/expanded_assets/pmd_releases/7.17.0). Both the Docker build and `scripts/container/fetch-pmd.sh` verify that checksum before extraction/use. The trusted executable is `/opt/pmd/bin/pmd`, selected through `REVIEW_ANALYSIS_PMD_BIN`.

The delivered image's ID and archive checksum identify the actual built package. Base images, npm dependencies, and PMD are pinned; Debian package indexes are consulted during source builds, so later rebuilds are not promised to produce an identical image ID. Windows `.cmd` launchers require validation on an actual Windows Docker Desktop installation; Linux Docker/Compose checks alone do not prove that host flow.
