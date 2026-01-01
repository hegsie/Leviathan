# Leviathan Roadmap

This document outlines planned features and improvements for future releases. For current features, see [README.md](README.md).

---

## UI/UX Enhancements

### Inline Editing
- Edit files directly in diff view
- Quick fixes for conflicts
- Syntax-aware editing

### Image Diff
- Side-by-side image comparison
- Onion skin overlay
- Swipe comparison
- Difference highlighting

### Commit Templates
- Save commit message templates
- Auto-populate from .gitmessage
- Template variables
- Conventional commits support

### Notifications
- Push/pull completion notifications
- Conflict alerts
- Background operation status
- System tray integration

### Auto-fetch
- Configurable periodic fetch
- Fetch on window focus
- Remote change indicators
- Background sync

---

## Workflow Support

### Git Flow
- Initialize Git Flow
- Feature/release/hotfix branches
- Automatic branch naming
- Finish operations
- Version tagging

### GitHub Flow
- Simplified branch workflow
- PR-centric development
- Auto-link to issues

### Trunk-Based Development
- Short-lived feature branches
- Feature flags integration

---

## Advanced Git Features

### Patch Operations
- Create patches (format-patch)
- Apply patches
- Apply mailbox patches (am)
- Send patches via email

### Archive & Export
- Create zip/tar archives
- Export specific commits
- Export with prefix

### Notes
- Add commit notes
- View notes
- Remove notes
- Push/pull notes

### Sparse Checkout
- Initialize sparse checkout
- Add/remove paths
- Cone mode support

### Shallow & Partial Clones
- Shallow clone (--depth)
- Deepen shallow clones
- Partial clone (--filter)
- Fetch missing objects

### Bundle Operations
- Create bundles
- Verify bundles
- Unbundle

---

## Maintenance & Performance

### Repository Maintenance
- Garbage collection (gc)
- Prune unreachable objects
- Repack objects
- Optimize repository

### Repository Health
- fsck (file system check)
- Verify pack files
- Check ref integrity
- Repair operations

### Performance Optimization
- Virtual scrolling improvements
- Lazy loading for large repos
- Background indexing
- Caching strategies

---

## Distribution & Releases

### macOS Code Signing
- Apple Developer Account setup
- Developer ID Application certificate
- Notarization for Gatekeeper
- Hardened runtime entitlements
- CI/CD integration for automated signing

### Windows Code Signing
- EV code signing certificate
- SmartScreen reputation building
- CI/CD integration

### Linux Packaging
- Flatpak distribution
- Snap package
- AppImage improvements
- Debian/RPM packages

### Auto-Updates
- Delta updates (smaller downloads)
- Update channels (stable, beta)
- Rollback support

---

## AI Enhancements

### Local AI Backends
- Auto-detect Ollama running locally (`localhost:11434`)
- Support LM Studio (`localhost:1234/v1`)
- Configurable model selection in settings
- Cache available models from `/api/tags`
- User choice between embedded model and external backends

### Cloud AI Providers
- **Anthropic Claude** - Claude API integration for commit messages, code review, PR descriptions
- **GitHub Copilot** - Integration with GitHub Copilot for code suggestions and explanations
- **OpenAI** - GPT-4 and future models for AI-assisted features
- **Google Gemini** - Gemini API support
- API key management with secure storage
- Provider selection in settings (local vs cloud)
- Usage tracking and cost estimates

### AI-Assisted Features
- Code review suggestions
- Commit message improvements
- Branch naming suggestions
- PR description generation
- Diff summarization
- Conflict resolution suggestions
- Code explanation for complex diffs

---

## Future Considerations

- Code review tools
- Team collaboration features
- Repository analytics & statistics
- Performance profiling
- Plugin/extension system
- Custom scripts/hooks UI
- Multi-language support (i18n)
- Accessibility improvements (a11y)
- Mobile companion app
