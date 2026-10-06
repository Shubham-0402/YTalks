package com.ytalks.backend.repository;

import com.ytalks.backend.entity.AiProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@link AiProvider} entities.
 */
@Repository
public interface AiProviderRepository extends JpaRepository<AiProvider, Long> {

    /**
     * Finds a provider by its name (case-insensitive).
     */
    Optional<AiProvider> findByProviderNameIgnoreCase(String providerName);

    /**
     * Finds all enabled providers.
     */
    List<AiProvider> findByEnabledTrue();

    /**
     * Checks if a provider with the given name exists.
     */
    boolean existsByProviderNameIgnoreCase(String providerName);
}