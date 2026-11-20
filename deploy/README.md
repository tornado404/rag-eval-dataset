# Optional private deployment

The deployment workflow uses a self-hosted runner. Do not attach that runner to this repository after it becomes public: public pull requests can introduce workflows that execute on an available self-hosted runner. Move deployment to a private repository or restrict an organization runner group to private repositories. Pull request validation in this repository uses a GitHub-hosted runner. See [GitHub's secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

The deployment script synchronizes application code to the configured machine and stores Golden data in a persistent directory outside the checkout. Set `GOLDEN_DATA_DIR` in the service environment to that directory. Existing data is preserved when code is updated.

The script uses `node` from `PATH` by default. Set `NODE_BIN`, `PORT`, `GOLDEN_PORT`, `LAUNCHD_LABEL`, and `PLIST_PATH` in the runner environment when the host needs different values. Keep runner labels, host addresses, service credentials, and private data paths in the deployment configuration rather than repository documentation.

Copy [`eval.env.example`](eval.env.example) into a private configuration directory and replace the example endpoints, model names, dataset IDs, and credentials. Do not commit the configured file.
