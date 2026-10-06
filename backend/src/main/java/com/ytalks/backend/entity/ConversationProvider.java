package com.ytalks.backend.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Join entity linking a conversation to the AI providers that have participated in it.
 * <p>
 * A conversation can involve multiple providers over its lifetime (via handoffs).
 * This entity records each provider used, when it was first used, and the message
 * count at that point. It is the authoritative source for "which providers have
 * touched this conversation" and enables features like provider badges in the UI.
 */
@Entity
@Table(name = "conversation_providers", indexes = {
        @Index(name = "idx_cp_conversation_id", columnList = "conversation_id"),
        @Index(name = "idx_cp_provider_id", columnList = "provider_id"),
        @Index(name = "idx_cp_first_used_at", columnList = "first_used_at")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_cp_conversation_provider", columnNames = {"conversation_id", "provider_id"})
})
public class ConversationProvider {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "conversation_id", nullable = false)
    private Conversation conversation;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "provider_id", nullable = false)
    private AiProvider provider;

    @Column(name = "first_used_at", nullable = false, updatable = false)
    private Instant firstUsedAt;

    @Column(name = "message_count", nullable = false)
    private int messageCount = 0;

    @PrePersist
    void onCreate() {
        this.firstUsedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Conversation getConversation() {
        return conversation;
    }

    public void setConversation(Conversation conversation) {
        this.conversation = conversation;
    }

    public AiProvider getProvider() {
        return provider;
    }

    public void setProvider(AiProvider provider) {
        this.provider = provider;
    }

    public Instant getFirstUsedAt() {
        return firstUsedAt;
    }

    public void setFirstUsedAt(Instant firstUsedAt) {
        this.firstUsedAt = firstUsedAt;
    }

    public int getMessageCount() {
        return messageCount;
    }

    public void setMessageCount(int messageCount) {
        this.messageCount = messageCount;
    }

    public void incrementMessageCount() {
        this.messageCount++;
    }
}