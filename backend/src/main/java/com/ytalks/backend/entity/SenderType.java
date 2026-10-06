package com.ytalks.backend.entity;

/**
 * Message sender type.
 * <p>
 * Used to distinguish between human users, AI assistants and system-generated
 * messages (e.g. handoff dividers). Stored as a string in the database so new
 * values can be added without a schema migration.
 */
public enum SenderType {
    USER,
    ASSISTANT,
    SYSTEM
}