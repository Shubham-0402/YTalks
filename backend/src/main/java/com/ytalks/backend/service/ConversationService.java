package com.ytalks.backend.service;

import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.entity.AiProvider;
import com.ytalks.backend.entity.ConversationProvider;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.repository.ConversationRepository;
import com.ytalks.backend.repository.MessageRepository;
import com.ytalks.backend.repository.AiProviderRepository;
import com.ytalks.backend.repository.ConversationProviderRepository;
import org.springframework.data.domain.Page;
import com.ytalks.backend.repository.ConversationProviderRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Service for conversation and message persistence operations.
 */
@Service
@Transactional(readOnly = true)
public class ConversationService {

    private final ConversationRepository conversationRepository;
    private final MessageRepository messageRepository;
    private final AiProviderRepository aiProviderRepository;
    private final ConversationProviderRepository conversationProviderRepository;

    public ConversationService(ConversationRepository conversationRepository,
                               MessageRepository messageRepository,
                               AiProviderRepository aiProviderRepository,
                               ConversationProviderRepository conversationProviderRepository) {
        this.conversationRepository = conversationRepository;
        this.messageRepository = messageRepository;
        this.aiProviderRepository = aiProviderRepository;
        this.conversationProviderRepository = conversationProviderRepository;
    }

    /* ------------------------------------------------------------------ */
    /* Conversations                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * Returns all conversations for a user, newest first.
     */
    public List<Conversation> findByUser(User user) {
        return conversationRepository.findByUserOrderByUpdatedAtDesc(user);
    }

    /**
     * Returns paginated conversations for a user.
     */
    public Page<Conversation> findByUser(User user, Pageable pageable) {
        return conversationRepository.findByUserOrderByUpdatedAtDesc(user, pageable);
    }

    /**
     * Finds a conversation by ID, ensuring it belongs to the given user.
     */
    public Optional<Conversation> findByIdAndUser(Long id, User user) {
        return conversationRepository.findByIdAndUser(id, user);
    }

    /**
     * Creates a new conversation for a user.
     */
    @Transactional
    public Conversation createConversation(User user, String title, String providerId, String model) {
        Conversation conversation = new Conversation();
        conversation.setUser(user);
        conversation.setTitle(title);
        conversation.setProviderId(providerId);
        conversation.setModel(model);
        return conversationRepository.save(conversation);
    }

    /**
     * Updates a conversation's title.
     */
    @Transactional
    public Conversation updateTitle(Long conversationId, User user, String title) {
        Conversation conversation = conversationRepository.findByIdAndUser(conversationId, user)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + conversationId));
        conversation.setTitle(title);
        return conversationRepository.save(conversation);
    }

    /**
     * Updates a conversation's current provider and model.
     */
    @Transactional
    public Conversation updateProvider(Long conversationId, User user, String providerId, String model) {
        Conversation conversation = conversationRepository.findByIdAndUser(conversationId, user)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + conversationId));
        conversation.setProviderId(providerId);
        conversation.setModel(model);
        
        // Record the provider usage if not already recorded
        if (providerId != null) {
            recordProviderUsage(conversation, providerId);
        }
        
        return conversationRepository.save(conversation);
    }

    /**
     * Deletes a conversation (cascades to messages and provider links).
     */
    @Transactional
    public void deleteConversation(Long conversationId, User user) {
        Conversation conversation = conversationRepository.findByIdAndUser(conversationId, user)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + conversationId));
        conversationRepository.delete(conversation);
    }

    /**
     * Clears all messages from a conversation but keeps the conversation itself.
     */
    @Transactional
    public Conversation clearConversation(Long conversationId, User user) {
        Conversation conversation = conversationRepository.findByIdAndUser(conversationId, user)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + conversationId));
        conversation.getMessages().clear();
        conversation.setTitle("New conversation");
        return conversationRepository.save(conversation);
    }

    /* ------------------------------------------------------------------ */
    /* Messages                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Returns all messages for a conversation, oldest first.
     */
    public List<Message> findMessages(Conversation conversation) {
        return messageRepository.findByConversationOrderByCreatedAtAsc(conversation);
    }

    /**
     * Returns paginated messages for a conversation.
     */
    public Page<Message> findMessages(Conversation conversation, Pageable pageable) {
        return messageRepository.findByConversationOrderByCreatedAtAsc(conversation, pageable);
    }

    /**
     * Adds a user message to a conversation.
     */
    @Transactional
    public Message addUserMessage(Conversation conversation, String content) {
        Message message = new Message();
        message.setConversation(conversation);
        message.setSenderType(SenderType.USER);
        message.setContent(content);
        return messageRepository.save(message);
    }

    /**
     * Adds an assistant message to a conversation.
     */
    @Transactional
    public Message addAssistantMessage(Conversation conversation, String content, String providerId, String model) {
        Message message = new Message();
        message.setConversation(conversation);
        message.setSenderType(SenderType.ASSISTANT);
        message.setContent(content);
        message.setProviderId(providerId);
        message.setModel(model);
        
        Message saved = messageRepository.save(message);
        
        // Record provider usage
        if (providerId != null) {
            recordProviderUsage(conversation, providerId);
        }
        
        return saved;
    }

    /**
     * Adds a system message (e.g., handoff divider) to a conversation.
     */
    @Transactional
    public Message addSystemMessage(Conversation conversation, String content) {
        Message message = new Message();
        message.setConversation(conversation);
        message.setSenderType(SenderType.SYSTEM);
        message.setContent(content);
        return messageRepository.save(message);
    }

    /**
     * Counts messages in a conversation.
     */
    public long countMessages(Conversation conversation) {
        return messageRepository.countByConversation(conversation);
    }

    /* ------------------------------------------------------------------ */
    /* Provider usage tracking                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Records that a provider was used in a conversation.
     * Increments the message count if the link already exists.
     */
    @Transactional
    public void recordProviderUsage(Conversation conversation, String providerId) {
        AiProvider provider = aiProviderRepository.findByProviderNameIgnoreCase(providerId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown provider: " + providerId));
        
        Optional<ConversationProvider> existing = conversationProviderRepository
                .findByConversationAndProvider(conversation, provider);
        
        if (existing.isPresent()) {
            existing.get().incrementMessageCount();
        } else {
            ConversationProvider cp = new ConversationProvider();
            cp.setConversation(conversation);
            cp.setProvider(provider);
            cp.setMessageCount(1);
            conversationProviderRepository.save(cp);
        }
    }

    /**
     * Returns all providers that have been used in a conversation.
     */
    public List<ConversationProvider> getConversationProviders(Conversation conversation) {
        return conversationProviderRepository.findByConversation(conversation);
    }
}