# 🚗 DriveConnect — Intelligent Car Rental Platform

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?style=for-the-badge&logo=chainlink&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)
![Pino](https://img.shields.io/badge/Pino-63B13C?style=for-the-badge&logo=pino&logoColor=white)

</div>

---

## 📌 Overview

**DriveConnect** is a modern, intelligent vehicle rental management platform designed to streamline operations and elevate customer experience. By integrating a **WhatsApp-based conversational AI Agent** with a robust, structured backend system and dedicated mobile applications, it ensures real-time vehicle dispatching, fast quotations, and instant secure payment confirmation.

The system leverages **Artificial Intelligence (AI)** and **Retrieval-Augmented Generation (RAG)** through LangChain and OpenAI to process conversations, extract intent, and interact directly with system databases.

---

## 🏗️ System Architecture

DriveConnect follows a modern, decoupled modular architecture:

```mermaid
graph TD
    User([Customer on WhatsApp]) <-->|WhatsApp Business API| Webhook[WhatsApp Webhook Router]
    Webhook <-->|Intent & Content| Agent[LangChain AI Agent]
    Agent <-->|Execute DB Actions| Tools[Agent Tools]
    Tools <-->|Query/Mutation| DB[(PostgreSQL Database)]
    
    subgraph Mobile Apps
        ClientApp[Flutter Client App] <-->|REST API| Backend[Express Backend REST API]
        ProviderApp[Flutter Admin App] <-->|REST API| Backend
    end
    
    Backend <-->|Data| DB
```

### Key Components

*   **Backend REST API**: An Express application built with TypeScript that exposes endpoints for administrative actions, fleet management, reservations, and reporting.
*   **AI Agent Layer**: A LangChain-driven engine running on the ReAct (Reasoning and Action) framework. It automates client interaction, matches intents (e.g. check availability, register client, quote, book), and triggers safe programmatic tools to query database state.
*   **Cross-Platform Mobile Apps**: Written in Flutter, providing tailored experiences:
    *   **Customer Experience**: Tracking active rentals, viewing payment histories, and communicating.
    *   **Admin Dashboard**: Tracking revenue, managing fleet status, resolving reservations, and updating rental configurations.

---

## ✨ Features

### 🤖 Intelligent WhatsApp Chatbot
*   **ReAct Agent Loop**: Natural multi-turn conversations that guide users through quotations, requirements, and policies.
*   **Automated Database Interactions**: Programmatically checks vehicle availability, registers accounts, and reserves cars.
*   **Prompt-Injection Protection**: Sanitization layer protecting against prompts designed to alter AI behavior.
*   **PII Redaction**: Automatic stripping of passwords, emails, and full CPFs/Documents from application logs.

### 🚗 Vehicle & Fleet Management
*   **Conflict-Free Booking Engine**: Real-time availability validation prevents double-booking.
*   **Insurance & Pricing Options**: Dynamically calculates rental rates based on branches, season, dates, and selected insurance plans.

### 💳 Modern Payment Flow
*   **InfinitePay Integration**: Automatically generates checkout links and processes payment approvals/refunds securely.

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+)
*   Flutter SDK & Dart
*   PostgreSQL Database

---

### 💻 Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd Backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment:
   *   Copy `.env.example` to `.env`.
   *   Populate the required credentials (`OPENAI_API_KEY`, `DATABASE_URL`, etc.).

4. Run migrations and database seeding:
   ```bash
   # Initialize tables
   npm run db:init
   # Seed default branches and vehicles
   npm run db:seed
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

---

### 📱 Frontend Setup (Flutter)

1. Navigate to the frontend directory:
   ```bash
   cd Frontend
   ```

2. Fetch Flutter packages:
   ```bash
   flutter pub get
   ```

3. Run the application:
   ```bash
   flutter run
   ```

---

## 🧪 Testing

The Backend test suite utilizes **Jest** to run unit and integration tests.

```bash
cd Backend
npm test
```

---

## 📄 License

This repository is licensed under the MIT License. Developed for educational and demonstration purposes.
