package com.ytalks.backend.repository;

import com.ytalks.backend.entity.ConversationProvider;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.AiProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@link ConversationProvider} entities.
 */
@Repository
public interface ConversationProviderRepository extends JpaRepository<ConversationProvider, Long> {

    /**
     * Finds all provider links for a conversation.
     */
    List<ConversationProvider> findByConversation(Conversation conversation);

    /**
     * Finds a specific conversation-provider link.
     */
    Optional<ConversationProvider> findByConversationAndProvider(Conversation conversation, AiProvider provider);

    /**
     * Checks if a conversation has used a specific provider.
     */
    boolean existsByConversationAndProvider(Conversation conversation, AiProvider provider);

    /**
     * Deletes all provider links for a conversation (used when deleting a conversation).
     */
    void deleteByConversation(Conversation conversation);
}