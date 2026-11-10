# Ytalks – Multi-AI Chat Platform

[![Java](https://img.shields.io/badge/Java-17-orange.svg)](https://www.oracle.com/java/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.x%20%2F%204.x-brightgreen.svg)](https://spring.io/projects/spring-boot)
[![MySQL](https://img.shields.io/badge/MySQL-8.4-blue.svg)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/License-Proprietary-lightgrey.svg)]()

> A unified, cross-model conversational workspace where users can seamlessly switch between top-tier AI providers (Google Gemini, Groq, OpenRouter) within the same conversation without losing context, message history, or conversational momentum.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Installation and Setup](#installation-and-setup)
  - [Prerequisites](#prerequisites)
  - [Step 1: Clone the Repository](#step-1-clone-the-repository)
  - [Step 2: Database Configuration](#step-2-database-configuration)
  - [Step 3: Environment Configuration](#step-3-environment-configuration)
  - [Step 4: Run the Backend](#step-4-run-the-backend)
  - [Step 5: Launch the Frontend](#step-5-launch-the-frontend)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Screenshots](#screenshots)
- [Future Improvements](#future-improvements)
- [Author](#author)

---

## Overview

Modern generative AI models each possess distinct strengths—reasoning, code synthesis, low-latency token streaming, or specialized domain knowledge. Traditionally, querying different models requires jumping across fragmented web interfaces and manually copy-pasting conversation histories.

**Ytalks** solves this friction by providing a unified multi-AI chat workspace. With Ytalks, you can hold an ongoing dialogue and switch between **Google Gemini**, ultra-fast **Groq** models, and **Gemma via OpenRouter** on the fly. Thanks to intelligent **cross-model context continuity**, conversation history is preserved in MySQL and automatically summarized or transferred to the incoming model, enabling frictionless multi-AI collaboration.

---

## Key Features

- **Multi-Model Provider Switching**: Seamlessly change AI providers mid-stream (Google Gemini, Groq, OpenRouter/Gemma) directly from the message composer.
- **Cross-AI Conversation Handoff**: Continue an existing conversation on a new AI engine with inherited context, branch into a fresh chat session, or cancel—maintaining context continuity across different LLMs.
- **Secure Authentication & OTP Verification**: User registration with real email verification and developer-friendly OTP logging modes, backed by industry-standard JWT authentication.
- **Persistent MySQL Storage**: Robust relational persistence of user accounts, conversations, multi-provider message trails, and AI metadata.
- **Zero-Dependency Modern Frontend**: Clean, responsive, vanilla JavaScript and CSS glassmorphism UI designed with high-contrast accessibility in a signature aesthetic palette:
  - **Ice Silver** (`#DCE3E8`)
  - **Deep Aubergine** (`#28152F`)
  - **Glowing Marigold** (`#FFB52E`)
- **Full Conversation Management**: Create, rename, search (by title or message contents), clear, duplicate, and delete chat threads.
- **Health Monitoring & Auto-Reconnect**: Automatic backend health polling and real-time provider readiness status.

---

## Technology Stack

### Backend
- **Language**: Java 17 (Amazon Corretto / OpenJDK)
- **Framework**: Spring Boot (Spring Web, Spring Security, Spring Data JPA)
- **Build Tool**: Apache Maven (via Maven Wrapper `mvnw` / `mvnw.cmd`)
- **Persistence & ORM**: Hibernate / Spring Data JPA
- **Database**: MySQL 8.4+
- **Security & Tokens**: JJWT (Java JWT `0.12.5`), BCrypt password hashing
- **AI Integrations**:
  - Google GenAI Java SDK (`com.google.genai:google-genai`)
  - Groq API (OpenAI-compatible REST client with HTTP Keep-Alive & timeout resilience)
  - OpenRouter API (Gemma 4 integration via REST)

### Frontend
- **Core**: Vanilla HTML5, CSS3, JavaScript (ES6+ Modules)
- **Styling Architecture**: Custom CSS Glassmorphism with ambient dynamic glow and high-contrast color tokens
- **Local Dev Server**: Node.js zero-dependency static file server (`tools/serve.js`)

---

## System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Browser Client                       │
│    (HTML5 / CSS3 / ES6+ JS / Glassmorphism UI)         │
└───────────────────────────┬────────────────────────────┘
                            │ REST / JSON (JWT Auth)
                            ▼
┌────────────────────────────────────────────────────────┐
│                Spring Boot REST Backend                │
│                                                        │
│  ┌──────────────────┐            ┌──────────────────┐  │
│  │ Security Filter  │            │  Chat & Context  │  │
│  │   & JWT Engine   │            │ Continuity Engine│  │
│  └────────┬─────────┘            └────────┬─────────┘  │
│           │                               │            │
│  ┌────────▼───────────────────────────────▼─────────┐  │
│  │                Service Layer                     │  │
│  │ (AuthService, ConversationService, GeminiService, │  │
│  │       GroqService, OpenRouterService)            │  │
│  └────────┬───────────────────────────────┬─────────┘  │
└───────────┼───────────────────────────────┼────────────┘
            │                               │
            ▼ JDBC                          ▼ HTTPS REST
┌──────────────────────┐   ┌─────────────────────────────────┐
│     MySQL 8.4        │   │       External AI Services      │
│ (Users, Conversations│   │  • Google Gemini API            │
│    Messages, OTPs)   │   │  • Groq API                     │
└──────────────────────┘   │  • OpenRouter API (Gemma)       │
                           └─────────────────────────────────┘
```

1. **Frontend**: Sends client requests to Spring Boot controllers using secure `Bearer` JWT tokens.
2. **Context Engine**: When a user switches models and submits a prompt, the backend retrieves conversation history from MySQL, formats the context for the target provider's schema, and injects continuity summaries.
3. **Provider Layer**: Communicates with upstream AI endpoints via isolated services with dedicated connection and read timeouts.
4. **Database Layer**: Persists user interactions, provider metadata, and message timestamps securely.

---

## Project Structure

```text
YTalks/
├── backend/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/ytalks/backend/
│   │   │   │   ├── controller/      # Auth, Chat, Conversation, Provider controllers
│   │   │   │   ├── model/           # JPA entities (User, Conversation, Message, etc.)
│   │   │   │   ├── repository/      # Spring Data JPA repositories
│   │   │   │   ├── security/        # JWT filters, security configuration
│   │   │   │   └── service/         # Business logic & AI provider clients
│   │   │   └── resources/
│   │   │       └── application.yml  # Application properties & provider configs
│   │   └── test/                    # Backend unit and integration tests
│   ├── .env.example                 # Template for environment configuration
│   ├── mvnw / mvnw.cmd              # Maven wrapper scripts
│   └── pom.xml                      # Maven dependencies and build plugins
├── frontend/
│   ├── assets/                      # Icons, logos, and UI graphics
│   ├── css/
│   │   ├── ambient.css              # Ambient background glow & animations
│   │   ├── auth.css                 # Auth modals & OTP forms
│   │   ├── chat.css                 # Message cards, composer, handoff modals
│   │   ├── sidebar.css              # Conversation list & navigation
│   │   └── styles.css               # Color variables and core typography
│   ├── js/
│   │   ├── api.js                   # Backend HTTP API client
│   │   ├── app.js                   # Application lifecycle & state bootstrap
│   │   ├── auth.js                  # Authentication & OTP flows
│   │   ├── chat.js                  # Message rendering & streaming
│   │   ├── handoff.js               # Cross-AI handoff orchestration
│   │   └── sidebar.js               # History management & search
│   └── index.html                   # Single-page interface
├── tools/
│   └── serve.js                     # Zero-dependency local static file server
├── docs/                            # Project specifications & milestone records
├── tests/                           # End-to-end and UI automation scripts
├── package.json                     # Frontend scripts and test dependencies
└── README.md                        # Project documentation
```

---

## Installation and Setup

### Prerequisites

- **Java Development Kit (JDK)**: Java 17 or higher (`java -version`)
- **Node.js**: v18+ (for running the local development server)
- **MySQL Server**: 8.0 or 8.4+ running locally on port `3306`
- **AI API Keys**: Valid API key from [Google AI Studio](https://aistudio.google.com/) and/or [Groq Console](https://console.groq.com/)

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/ytalks.git
cd ytalks
```

---

### Step 2: Database Configuration

Ensure your MySQL instance is running. The database `ytalks` will be created automatically upon backend startup if it does not already exist.

To verify MySQL via terminal:
```bash
mysql -u root -p -e "SHOW DATABASES;"
```

---

### Step 3: Environment Configuration

Create a `.env` file in the `backend/` directory by copying the example:

```bash
# On Linux / macOS
cp backend/.env.example backend/.env

# On Windows (PowerShell)
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env` with your actual database credentials and API keys (see [Environment Variables](#environment-variables)).

---

### Step 4: Run the Backend

Navigate to the `backend` folder and run the Spring Boot application using the included Maven Wrapper:

**Windows (PowerShell / CMD):**
```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

**macOS / Linux:**
```bash
cd backend
chmod +x mvnw
./mvnw spring-boot:run
```

Once running, verify backend health:
```bash
curl http://localhost:8080/api/health
```
*Expected response:* `{"status":"UP","version":"0.4.0",...}`

---

### Step 5: Launch the Frontend

In a separate terminal at the project root (`YTalks/`):

```bash
npm install
npm start
```

The frontend will be available at:
👉 **`http://localhost:4173`** (or `http://127.0.0.1:4173`)

---

## Environment Variables

Configure these variables in `backend/.env` or in your system environment. **Never commit actual keys or secrets to version control.**

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `YTALKS_PORT` | Port the Spring Boot REST API listens on | `8080` |
| `YTALKS_CORS_ALLOWED_ORIGINS` | Permitted frontend origins (comma-separated) | `http://localhost:4173,http://localhost:3000` |
| `YTALKS_DB_HOST` | MySQL hostname | `localhost` |
| `YTALKS_DB_PORT` | MySQL port | `3306` |
| `YTALKS_DB_NAME` | Database schema name | `ytalks` |
| `YTALKS_DB_USERNAME` | MySQL database username | `root` |
| `YTALKS_DB_PASSWORD` | MySQL database password | `your_secure_password` |
| `YTALKS_JWT_SECRET` | 256-bit+ random secret string for JWT signing | `your-secure-jwt-secret-key-at-least-32-chars` |
| `YTALKS_JWT_EXPIRATION_MS` | JWT validity duration in milliseconds | `86400000` *(24 hours)* |
| `YTALKS_OTP_DEV_MODE` | Prints OTP codes to backend console (dev only) | `true` |
| `GEMINI_API_KEY` | Google Gemini API key from Google AI Studio | `your_gemini_api_key` |
| `GEMINI_MODEL` | Active Gemini model identifier | `gemini-3.5-flash-lite` |
| `GROQ_API_KEY` | Groq Cloud API key | `your_groq_api_key` |
| `GROQ_MODEL` | Active Groq model identifier | `openai/gpt-oss-20b` |
| `OPENROUTER_API_KEY` | OpenRouter API key *(optional for Gemma 4)* | `your_openrouter_api_key` |
| `OPENROUTER_MODEL` | OpenRouter model identifier | `google/gemma-4-26b-a4b-it:free` |

---

## API Overview

The Spring Boot backend exposes a clean RESTful API:

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Register a new user and generate a verification OTP.
- `POST /api/auth/verify-otp` — Verify OTP code and receive a JWT Bearer token.
- `POST /api/auth/resend-otp` — Request a fresh OTP for verification.
- `POST /api/auth/login` — Authenticate existing credentials and issue a JWT.
- `GET /api/auth/me` — Retrieve the current authenticated user's profile.

### Conversations (`/api/conversations`)
- `GET /api/conversations` — Fetch all conversations belonging to the user.
- `POST /api/conversations` — Create a new conversation thread.
- `GET /api/conversations/{id}` — Fetch conversation details with message history.
- `PATCH /api/conversations/{id}` — Update conversation title or preferred provider.
- `DELETE /api/conversations/{id}` — Permanently remove a conversation.
- `POST /api/conversations/{id}/clear` — Clear message history while keeping the thread.

### Chat & AI Execution (`/api/chat`)
- `POST /api/chat/{conversationId}/messages` — Submit a user message, trigger downstream AI generation with context continuity, and persist replies.
- `GET /api/chat/providers` — List available and active AI models and their operational status.

### Health & Monitoring
- `GET /api/health` — Returns system uptime, database connectivity, and backend build version.

---

## Screenshots

<!-- Add your screenshots by replacing the placeholder links below -->

### 1. Main Chat Interface & Provider Selector
![Main Chat Interface](docs/screenshots/chat-interface.png)
*Ytalks signature Glassmorphism chat view with active model selection and conversation history.*

---

### 2. Cross-AI Handoff in Action
![Cross-AI Handoff](docs/screenshots/cross-ai-handoff.png)
*Switching from Gemini to Groq mid-conversation with contextual inheritance options.*

---

### 3. Authentication & OTP Verification
![Authentication and OTP](docs/screenshots/auth-otp.png)
*User registration with integrated email/console OTP verification.*

---

## Future Improvements

- [ ] **Additional Provider Integrations**:
  - Anthropic Claude (Claude 3.5 Sonnet / Haiku)
  - OpenAI direct integration (GPT-4o / GPT-4o-mini)
  - DeepSeek API (DeepSeek-V3 / R1)
- [ ] **Streaming Responses (SSE)**: Real-time Server-Sent Events token streaming for zero-latency typewriter output.
- [ ] **Document & Attachment Uploads**: Multimodal image, PDF, and source code context attachments.
- [ ] **Export & Sharing**: Export full cross-model chat transcripts to Markdown, JSON, or PDF with provider attribution tags.
- [ ] **Granular Context Trimming**: Visual token budget inspector allowing users to curate which historical messages are passed during cross-model handoffs.

---

## Author

**Shubham Verma**
- GitHub: [@your-github-username](https://github.com)
- Project Repository: [YTalks](https://github.com/your-username/ytalks)

---
*Built with passion for seamless artificial intelligence interactions.*
