package com.ytalks.backend.service;

import com.ytalks.backend.entity.AiProvider;
import com.ytalks.backend.repository.AiProviderRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Service for AI provider persistence operations.
 * <p>
 * Providers are seeded at application startup. This service provides read
 * access and basic management; no API keys or secrets are stored here.
 */
@Service
@Transactional(readOnly = true)
public class AiProviderService {

    private final AiProviderRepository providerRepository;

    public AiProviderService(AiProviderRepository providerRepository) {
        this.providerRepository = providerRepository;
    }

    /**
     * Returns all enabled providers, ordered by name.
     */
    public List<AiProvider> getEnabledProviders() {
        return providerRepository.findByEnabledTrue();
    }

    /**
     * Returns all providers (enabled and disabled).
     */
    public List<AiProvider> getAllProviders() {
        return providerRepository.findAll();
    }

    /**
     * Finds a provider by its name (case-insensitive).
     */
    public Optional<AiProvider> findByName(String providerName) {
        return providerRepository.findByProviderNameIgnoreCase(providerName);
    }

    /**
     * Finds a provider by ID.
     */
    public Optional<AiProvider> findById(Long id) {
        return providerRepository.findById(id);
    }

    /**
     * Creates a new provider record.
     */
    @Transactional
    public AiProvider createProvider(String providerName, String providerType, boolean enabled) {
        if (providerRepository.existsByProviderNameIgnoreCase(providerName)) {
            throw new IllegalArgumentException("Provider '" + providerName + "' already exists");
        }
        AiProvider provider = new AiProvider();
        provider.setProviderName(providerName);
        provider.setProviderType(providerType);
        provider.setEnabled(enabled);
        return providerRepository.save(provider);
    }

    /**
     * Updates a provider's enabled status.
     */
    @Transactional
    public AiProvider setEnabled(Long id, boolean enabled) {
        AiProvider provider = providerRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Provider not found: " + id));
        provider.setEnabled(enabled);
        return providerRepository.save(provider);
    }

    /**
     * Ensures a provider exists, creating it if necessary.
     * Used during application startup seeding.
     */
    @Transactional
    public AiProvider ensureProvider(String providerName, String providerType, boolean enabled) {
        return providerRepository.findByProviderNameIgnoreCase(providerName)
                .orElseGet(() -> createProvider(providerName, providerType, enabled));
    }
}