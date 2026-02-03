# AI Agent Collaboration Guide

This document provides guidelines for AI agents collaborating on the `plane-cli` project. Its purpose is to ensure that AI contributions are aligned with the project's goals, architecture, and coding standards.

## 1.0 Project Overview

The `plane-cli` is a command-line interface for the Plane.so project management system. The primary goal is to provide a fast, scriptable, and user-friendly tool for developers and automated systems to interact with Plane.so.

**Core Documentation:** For a complete understanding of the CLI's features, commands, and architecture, please review the [Plane.so CLI Specification](plane-cli-spec.md).

## 2.0 The Agent's Role

As an AI agent, you are a collaborator in this project. Your primary responsibilities include:

- **Implementing Features:** Writing Rust code to implement new commands and features as defined in the specification.
- **Writing Tests:** Creating unit and integration tests to ensure the reliability and correctness of the code.
- **Bug Fixes:** Identifying and fixing bugs in the existing codebase.
- **Refactoring:** Improving the codebase's structure, performance, and readability without changing its external behavior.
- **Documentation:** Assisting in the creation and maintenance of user and developer documentation.

## 3.0 Getting Started

To begin, you will need to familiarize yourself with the project structure and build process.

1.  **List Files:** Start by listing the files in the current directory avoiding the folder `target` to understand the layout of the project.
2.  **Read `Cargo.toml`:** This file contains the project's dependencies and metadata. Use the `read` command to inspect its contents.
3.  **Build the Project:** Use the `cargo build` command to compile the project. This will verify that you have a working development environment.
4.  **Run Tests:** Execute `cargo test` to run the existing test suite and ensure that everything is functioning correctly.

## 4.0 Core Development Workflow

To ensure clarity and developer oversight, agents must adhere to the following workflow. **The agent must not write any code until the developer has explicitly approved the implementation plan.**

1.  **User Prompt:** The developer initiates a task with a specific goal.
2.  **Codebase Grounding:** Before proposing a solution, the agent must ground its understanding by exploring the existing codebase. This involves identifying relevant files, understanding data structures, and analyzing existing patterns. Avoid searching on the items described in `.gitignore`.
3.  **Specification Generation:** Based on its findings, the agent will create or update a specification file in the `specs/` directory. This file, in Markdown format, should detail the proposed changes, including:
    *   The files to be modified.
    *   The specific code additions, deletions, or modifications.
    *   Any new dependencies required.
    *   The expected outcome of the changes.
4.  **User Review and Approval of Specification:** The developer reviews the specification file. No further action is taken until the developer approves it.
5.  **Implementation Plan:** Once the specification is approved, the agent will generate a detailed, step-by-step implementation plan. The plan must adhere to Test-Driven Development (TDD) principles, outlining a cycle of writing a failing test, implementing the code to make it pass, and refactoring.
6.  **User Review and Approval of Plan:** The developer reviews the implementation plan.
7.  **Implementation:** Only after the developer explicitly approves the plan will the agent proceed with implementing the changes to the project's source code. The agent must follow the plan precisely.
8.  **Verification:** After implementation, the agent should run tests to verify that the changes work as expected and have not introduced any regressions.
9.  **Summarize and Conclude:** Provide a concise summary of the implemented changes.

This process ensures that the developer has full control over the changes being made to the codebase.

## 5.0 Code Style & Conventions

- **Formatting:** All Rust code should be formatted using `cargo fmt`.
- **Clippy:** The code should be free of any warnings from `clippy`. Run `cargo clippy -- -D warnings` to check.
- **Error Handling:** Use the `thiserror` crate for error handling. Do not use `unwrap()` or `expect()` in application logic.
- **Dependencies:** Use `cargo-edit` to add, remove, or update dependencies.

## 6.0 Code Organization Convention

The project follows a natural, organic approach to code organization where structure emerges from complexity rather than being imposed prematurely.

### The Natural Growth Pattern

1. **Start Simple:** Begin with a single `.rs` file for new functionality
2. **Grow:** Add features to that file as the module evolves
3. **Split:** When complexity emerges (~500-1000 lines or clear conceptual divisions), create a directory and split into logical components
4. **Nest:** When a component grows complex, apply the same pattern recursively
5. **Elevate:** When multiple modules need the same code, move it up the directory tree to the lowest common ancestor

### Key Principles

- **Avoid Premature Abstraction:** Don't create directories or split files "just in case"
- **Follow Domain Boundaries:** Group by feature/responsibility, not by technical layer
- **Maintain Public APIs:** When refactoring, keep the same public interface via `mod.rs`
- **Keep Related Code Close:** Code that changes together should live together
- **Test Structure Mirrors Source:** When splitting a module, consider splitting its tests accordingly

### Example Evolution

```
# Stage 1: Single file
src/commands.rs

# Stage 2: Directory with components  
src/commands/
  mod.rs
  issues.rs
  projects.rs
  workspaces.rs

# Stage 3: Nested complexity
src/commands/
  mod.rs
  issues/
    mod.rs
    create.rs
    list.rs
    update.rs
  projects.rs
  workspaces.rs

# Stage 4: Elevation for reuse
src/
  commands/
  api/
  utils.rs  # Elevated when multiple modules needed it
```

## 7.0 Testing

The project maintains a high standard of testing.

- **Unit Tests:** Each module should have its own set of unit tests.
- **Integration Tests:** More extensive tests that cover the interaction of multiple modules can be found in the `tests` directory.
- **Running Tests:** Use `cargo test` to run all tests.

### Guidelines for Writing Tests

- **Parallel Testing & Data Isolation:** Integration tests are executed in parallel by default. To prevent interference, ensure tests are independent and don't rely on shared mutable state.
- **Idempotency & Repeatability:** Tests must be written such that they pass even if run multiple times against the same environment without resetting state.
- **Write Additive and Independent Tests:** Tests should be self-contained and not depend on the state or outcome of other tests.

By following these guidelines, you can be an effective and valuable contributor to the `plane-cli` project.
