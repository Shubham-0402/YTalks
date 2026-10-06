package com.ytalks.backend.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * AI provider reference record.
 * <p>
 * This entity represents a known AI provider (OpenAI, Google Gemini, etc.).
 * It does NOT store API keys, secrets or credentials — those are handled
 * securely in a later milestone. This table is seeded at startup with the
 * four providers the product supports.
 */
@Entity
@Table(name = "ai_providers", indexes = {
        @Index(name = "idx_ai_providers_name", columnList = "provider_name", unique = true),
        @Index(name = "idx_ai_providers_enabled", columnList = "enabled")
})
public class AiProvider {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "provider_name", nullable = false, length = 50, unique = true)
    private String providerName;

    @Column(name = "provider_type", nullable = false, length = 50)
    private String providerType;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getProviderName() {
        return providerName;
    }

    public void setProviderName(String providerName) {
        this.providerName = providerName;
    }

    public String getProviderType() {
        return providerType;
    }

    public void setProviderType(String providerType) {
        this.providerType = providerType;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}