# SmarTab Agent Guidelines

This document defines the design philosophy, development standards, and project structure for SmarTab. All agents and contributors must follow these guidelines.

---

## Core Design Philosophy

### 1. Invisible Automation

**Goal: Minimize user awareness of auto-grouping; reduce interruption to zero.**

- Auto-grouping should feel like magic, not a distraction
- Users should never be interrupted or forced to make decisions during automatic operations
- All automated actions must be reversible with one click (undo)
- Delays and timing should be carefully tuned to avoid disrupting user workflow
- Never show unnecessary notifications, modals, or confirmations for automated actions
- The best automation is the one users don't notice until they need it

### 2. Best-in-Class Tab Search

**Goal: Tab search must be the fastest and most intuitive way to find any tab.**

- Search should be instant (no perceptible delay)
- Support fuzzy matching for typos and partial queries
- Keyboard-first experience (activate with `/`, navigate with arrows, select with Enter)
- Search should cover: tab titles, URLs, and group names
- Results should be ranked by relevance, not just recency
- Search UI should be minimal and non-blocking

### 3. Crystal Clear Interface

**Goal: Users should immediately understand what they can do.**

- Every UI element must have a clear, singular purpose
- No feature bloat - if it's not essential, don't show it
- Use familiar patterns and conventions
- Labels should be action-oriented (verbs, not nouns)
- Status and feedback must be immediate and unambiguous
- Progressive disclosure: show advanced options only when needed

---

## UI/UX Standards

### Design Principles

- **Minimalist**: Clean layouts with generous whitespace
- **Functional**: Every element serves a purpose
- **Consistent**: Unified visual language across all surfaces
- **Accessible**: High contrast, readable fonts, keyboard navigation
- **Fast**: No unnecessary animations that slow down interaction

### Visual Style

- NO flashy gradients or excessive decorations
- Subtle, purposeful color usage
- Clear visual hierarchy through typography and spacing
- Smooth, quick micro-interactions (< 200ms)
- Use system fonts when possible for native feel

### Color Palette

```css
--brand-teal: #0f766e;     /* Primary actions */
--accent-orange: #f97316;  /* Highlights, warnings */
--accent-blue: #0ea5e9;    /* Links, info */
--neutral-*: gray scale;   /* Backgrounds, text */
```

---

## Development Standards

### Language Requirements

- **All code**: English
- **All comments**: English
- **All documentation**: English
- **Variable/function names**: English, descriptive
- **Commit messages**: English

### Code Style

- Use modern JavaScript (ES6+)
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw Promises when possible
- Keep functions small and focused (single responsibility)
- Use meaningful variable names that describe intent
- Add comments only when the "why" is not obvious from code

### File Organization

- Keep related code in the same module
- One concern per file
- Export only what's necessary
- Use clear, descriptive file names

### Error Handling

- Always handle API errors gracefully
- Provide user-friendly error messages
- Never expose technical details to users
- Log errors for debugging without disrupting UX

---

## Project Structure

```
smarTab/
├── manifest.json           # Extension configuration (MV3)
├── background.js           # Service worker - event orchestration
├── popup.html/js/css       # Main extension popup UI
├── settings.html/js/css    # Settings/options page
├── modules/
│   ├── config.js           # Constants, defaults, utilities
│   ├── ai.js               # AI provider integration (OpenAI, Gemini, Custom)
│   ├── tabs.js             # Tab and group management logic
│   └── features.js         # Sessions, templates, undo functionality
├── styles/
│   └── main.css            # Design system and shared styles
├── images/
│   ├── 16.png              # Extension icon 16x16
│   ├── 48.png              # Extension icon 48x48
│   └── 128.png             # Extension icon 128x128
├── README.md               # Project documentation
└── AGENTS.md               # This file - agent guidelines
```

### Key Files Explained

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension configuration, permissions, shortcuts |
| `background.js` | Service worker handling all extension events and message routing |
| `popup.js` | Popup UI logic: stats, grouping, search, quick actions |
| `settings.js` | Settings page: AI config, automation, sessions, templates |
| `modules/config.js` | Shared constants, defaults, utility functions |
| `modules/ai.js` | AI provider abstraction (OpenAI, Gemini, custom APIs) |
| `modules/tabs.js` | Tab operations, auto-grouping, collapse management |
| `modules/features.js` | Session save/restore, templates, undo history |

---

## Tech Stack

### Core Technologies

- **Vanilla JavaScript** (ES6+ modules)
- **Chrome Extension Manifest V3**
- **HTML5 / CSS3** with custom properties

### Chrome APIs Used

- `chrome.tabs` - Tab manipulation
- `chrome.tabGroups` - Group management
- `chrome.storage.sync` - Synchronized settings storage
- `chrome.runtime` - Message passing between components
- `chrome.commands` - Keyboard shortcut handling

### External Integrations

- **OpenAI API** (gpt-4o-mini default)
- **Google Gemini API** (gemini-2.0-flash default)
- **Custom OpenAI-compatible APIs** (OpenRouter, local LLMs, etc.)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
├─────────────┬─────────────┬─────────────────────────────┤
│   Popup     │  Settings   │      Background (SW)        │
│  (popup.*)  │ (settings.*)│      (background.js)        │
├─────────────┴─────────────┴─────────────────────────────┤
│                    Message Passing                       │
├─────────────────────────────────────────────────────────┤
│                      Modules                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ config   │  │   ai     │  │  tabs    │  │ features │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
├─────────────────────────────────────────────────────────┤
│              Chrome APIs & External APIs                 │
│  ┌──────────────────────┐  ┌────────────────────────┐   │
│  │ chrome.tabs/groups   │  │ OpenAI / Gemini / etc  │   │
│  │ chrome.storage       │  │                        │   │
│  └──────────────────────┘  └────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Communication Flow

1. **Popup/Settings** → `chrome.runtime.sendMessage()` → **Background**
2. **Background** processes request using module functions
3. **Modules** interact with Chrome APIs and external AI providers
4. Response returned to caller

---

## Feature Implementation Guide

### Adding New Features

1. For complex tasks, create a detailed plan before implementation
2. Determine which module the feature belongs to
3. Keep UI changes minimal and consistent with existing patterns
4. Ensure all automated behaviors are reversible
5. Add appropriate error handling
6. Test across different tab/group states

### Modifying Existing Features

1. Understand the current implementation fully before changing
2. Preserve backward compatibility with stored settings
3. Test edge cases (many tabs, no tabs, mixed states)
4. Update documentation if behavior changes

### Performance Considerations

- Minimize storage reads/writes (batch when possible)
- Use debouncing for frequent events
- Avoid blocking the main thread
- Keep API calls efficient (batch tab info when possible)

---

## Testing Checklist

Before submitting changes:

- [ ] Works with 0 tabs, 1 tab, and 100+ tabs
- [ ] Works with 0 groups, 1 group, and many groups
- [ ] Auto-grouping doesn't interrupt user actions
- [ ] Undo works correctly for all automated actions
- [ ] Search finds tabs accurately and quickly
- [ ] Settings persist correctly across browser restarts
- [ ] No console errors or warnings
- [ ] All text is in English

---

## Summary

**Remember the three pillars:**

1. **Invisible** - Automation that doesn't interrupt
2. **Searchable** - Find any tab instantly
3. **Clear** - UI that explains itself

Build features that embody these principles, and SmarTab will remain a tool users love to use.
