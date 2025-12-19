# Obsidian Second Brain Agent (OSBA) Development Specification

## 1. Executive Summary
This project aims to build an Obsidian Plugin that functions as an intelligent "Second Brain" automation system. It utilizes a hybrid AI approach (Gemini for low-cost generation, Grok/Claude for high-context analysis) to autonomously manage, link, and expand the user's knowledge base.

**Key Definition:** The plugin will act as a **Controller (UI)** that delegates heavy cognitive tasks to a robust **Background Terminal Process (CLI Agent)**, ensuring the Obsidian interface remains fluid while complex analysis runs asynchronously.

## 2. System Architecture

The system consists of two distinct parts communicating via local shell execution.

### A. The Frontend (Obsidian Plugin)
*   **Role**: UI, Command Trigger, Queue Visualization.
*   **Implementation**: TypeScript.
*   **Responsibility**:
    *   Capture user intent (e.g., "Write a note about X", "Analyze connections for this note").
    *   **Spawn Terminal Commands**: Executes the background script/CLI using `child_process`.
    *   **File Watching**: Detects changes made by the CLI agent and refreshes the UI.
    *   **Status Dashboard**: Displays the "Agent Queue" (e.g., "3 jobs running, 5 pending").

### B. The Backend (Terminal / CLI Engine)
*   **Role**: The "Brain" execution engine. (This meets the requirement to "run via terminal").
*   **Implementation**: Python (Recommended for robust library support) or Node.js.
*   **Responsibility**:
    1.  **Context Loading**: Reads the Vault files (capable of handling 2M+ tokens for Grok).
    2.  **API Orchestration**:
        *   **Fast Lane (Gemini)**: For generation and simple formatting.
        *   **Deep Lane (Grok/Claude)**: For full-vault scanning, backlinking, and gap analysis.
    3.  **File Operations**: Directly modifies `.md` files (injecting YAML, links, appending ideas).

---

## 3. Core Features & Workflow

### Feature 1: The "Lite" Writer (Gemini Agent)
*   **Trigger**: Command Palette `OSBA: Quick Draft` or `OSBA: Polish Note`.
*   **Process**:
    1.  User inputs a prompt.
    2.  Plugin runs: `python agent.py --task draft --model gemini --prompt "..."`
    3.  CLI fetches content, generates markdown, and creates the file.
    4.  Plugin notifies "Draft Created".

### Feature 2: The "Deep" Archivist (Grok/Claude Agent)
*   **Trigger**: Auto-runs on new file creation OR Manual trigger `OSBA: Scan Vault Connections`.
*   **Process**:
    1.  Plugin runs: `python agent.py --task analyze --file "NewNote.md" --context "full_vault"`
    2.  **Background Operation**:
        *   CLI reads all `.md` files in the vault (simulating 2M context).
        *   Sends bulk context to Grok API.
        *   Prompt: "Analyze this new note within the context of these 500 existing notes. Suggest backlinks and gap analysis."
    3.  **Result Application**:
        *   CLI appends a section `## 🧠 Connected Insights` to the note.
        *   CLI updates the YAML frontmatter `related: [...]`.

### Feature 3: Asynchronous Job Queue
*   **Concept**: Mimics a "Task Manager" in the terminal.
*   **UI**: A sidebar view showing:
    *   🟢 Job #101: Scanning Vault... (Running)
    *   🟡 Job #102: Gemini Draft (Pending)
*   **Mechanism**: The CLI updates a small `status.json` file in the `.obsidian` folder, which the plugin watches to update the progress bar.

---

## 4. Technical Specifications

### Tech Stack
*   **Plugin Framework**: Obsidian API standards.
*   **CLI Engine**:
    *   Language: Python 3.10+ (using `langchain` or direct `requests` for API control).
    *   Libraries: `watchdog` (for file monitoring), `openai`/`google-generativeai` SDKs.
*   **Communication**: Standard I/O (Plugin spawns Process, reads `stdout` for logs).

### Context Strategy (The "2M Token" Logic)
*   **Direct Feed**: For Grok, we can feed raw text from the Vault.
*   **Optimization**: To avoid re-reading 10,000 files every time:
    1.  The CLI maintains a cached "summary" file of the vault (a lightweight vector index or concatenated summary).
    2.  Only full context is loaded when "Deep Analysis" is explicitly requested.

---

## 5. Feasibility Constraints & Solutions
*   **Constraint**: Running Python scripts requires the user to have Python installed.
    *   *Solution*: The plugin settings will have a field: `Path to Python Executable` or `Path to CLI Script`.
*   **Constraint**: API Costs for massive scanning.
    *   *Solution*: Implement a "Budget Mode" where the Deep Agent only runs on specific folders or upon explicit confirmation.

---

### 🚀 Roadmap to Prototype
1.  **Step 1 (The CLI)**: Write a simple Python script `agent.py` that takes a file path, reads it, calls Gemini API, and appends a summary. Test this in your terminal.
2.  **Step 2 (The Plugin Bridge)**: Create a basic Obsidian plugin that has a button to spawn `python agent.py`.
3.  **Step 3 (Integration)**: Pass the current active file path from Obsidian to the Python script.
4.  **Step 4 (Deep Logic)**: Implement the Grok 2M context logic in the Python script.
