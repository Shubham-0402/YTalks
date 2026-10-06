package com.ytalks.backend.controller;

import com.ytalks.backend.dto.*;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.ResourceNotFoundException;
import com.ytalks.backend.service.ConversationService;
import com.ytalks.backend.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * REST endpoints for conversation and message persistence (Milestone 3).
 * <p>
 * These endpoints exist to verify database persistence works. They use a
 * development-only mechanism for user identification (header-based) since
 * authentication is not implemented until Milestone 4.
 * <p>
 * In production, these endpoints would be protected by Spring Security and
 * the user would be obtained from the authentication context.
 */
@RestController
@RequestMapping("/api/conversations")
public class ConversationController {

    private static final Logger log = LoggerFactory.getLogger(ConversationController.class);

    private final ConversationService conversationService;
    private final UserService userService;

    public ConversationController(ConversationService conversationService, UserService userService) {
        this.conversationService = conversationService;
        this.userService = userService;
    }

    /**
     * Development helper: resolves the current user from the {@code X-User-Id} header.
     * Returns a default test user if no header is present (for easy testing).
     * <p>
     * THIS IS A TEMPORARY MECHANISM FOR MILESTONE 3 TESTING ONLY.
     * Authentication will replace this in Milestone 4.
     */
    private User resolveCurrentUser(@RequestHeader(value = "X-User-Id", required = false) String userIdHeader) {
        Long userId;
        if (userIdHeader != null && !userIdHeader.isBlank()) {
            try {
                userId = Long.parseLong(userIdHeader);
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Invalid X-User-Id header: must be a number");
            }
        } else {
            // Default to user ID 1 for testing convenience
            userId = 1L;
        }
        return userService.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId.toString()));
    }

    /* ------------------------------------------------------------------ */
    /* Conversation list & creation                                         */
    /* ------------------------------------------------------------------ */

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<ConversationSummary>> listConversations(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        User user = resolveCurrentUser(userIdHeader);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt"));
        Page<Conversation> conversationsPage = conversationService.findByUser(user, pageable);

        List<ConversationSummary> summaries = conversationsPage.getContent().stream()
                .map(this::toSummary)
                .collect(Collectors.toList());

        return ResponseEntity.ok(summaries);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationSummary> createConversation(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @RequestBody CreateConversationRequest request) {

        User user = resolveCurrentUser(userIdHeader);

        String title = (request.title() != null && !request.title().isBlank())
                ? request.title()
                : "New conversation";
        String providerId = request.providerId();
        String model = request.model();

        Conversation conversation = conversationService.createConversation(user, title, providerId, model);
        return ResponseEntity.status(HttpStatus.CREATED).body(toSummary(conversation));
    }

    /* ------------------------------------------------------------------ */
    /* Conversation detail                                                  */
    /* ------------------------------------------------------------------ */

    @GetMapping(value = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationDetail> getConversation(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id) {

        User user = resolveCurrentUser(userIdHeader);
        Conversation conversation = conversationService.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResourceNotFoundException("Conversation", id.toString()));

        List<MessageSummary> messages = conversationService.findMessages(conversation).stream()
                .map(this::toMessageSummary)
                .collect(Collectors.toList());

        ConversationDetail detail = new ConversationDetail(
                conversation.getId(),
                conversation.getTitle(),
                conversation.getProviderId(),
                conversation.getModel(),
                conversation.getCreatedAt(),
                conversation.getUpdatedAt(),
                messages
        );
        return ResponseEntity.ok(detail);
    }

    @PatchMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationSummary> updateConversation(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id,
            @RequestBody UpdateConversationRequest request) {

        User user = resolveCurrentUser(userIdHeader);
        Conversation conversation = conversationService.updateProvider(id, user,
                request.providerId(), request.model());

        if (request.title() != null && !request.title().isBlank()) {
            conversation = conversationService.updateTitle(id, user, request.title());
        }

        return ResponseEntity.ok(toSummary(conversation));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteConversation(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id) {

        User user = resolveCurrentUser(userIdHeader);
        conversationService.deleteConversation(id, user);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/{id}/clear", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationSummary> clearConversation(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id) {

        User user = resolveCurrentUser(userIdHeader);
        Conversation conversation = conversationService.clearConversation(id, user);
        return ResponseEntity.ok(toSummary(conversation));
    }

    /* ------------------------------------------------------------------ */
    /* Messages                                                             */
    /* ------------------------------------------------------------------ */

    @GetMapping(value = "/{id}/messages", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<MessageSummary>> getMessages(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        User user = resolveCurrentUser(userIdHeader);
        Conversation conversation = conversationService.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResourceNotFoundException("Conversation", id.toString()));

        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "createdAt"));
        Page<Message> messagesPage = conversationService.findMessages(conversation, pageable);

        List<MessageSummary> summaries = messagesPage.getContent().stream()
                .map(this::toMessageSummary)
                .collect(Collectors.toList());

        return ResponseEntity.ok(summaries);
    }

    @PostMapping(value = "/{id}/messages", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<MessageSummary> addMessage(
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
            @PathVariable Long id,
            @RequestBody AddMessageRequest request) {

        User user = resolveCurrentUser(userIdHeader);
        Conversation conversation = conversationService.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResourceNotFoundException("Conversation", id.toString()));

        if (request.senderType() == null || request.content() == null || request.content().isBlank()) {
            throw new IllegalArgumentException("senderType and content are required");
        }

        SenderType senderType;
        try {
            senderType = SenderType.valueOf(request.senderType().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid senderType: must be USER, ASSISTANT, or SYSTEM");
        }

        Message message;
        switch (senderType) {
            case USER -> message = conversationService.addUserMessage(conversation, request.content());
            case ASSISTANT -> message = conversationService.addAssistantMessage(
                    conversation, request.content(), request.providerId(), request.model());
            case SYSTEM -> message = conversationService.addSystemMessage(conversation, request.content());
            default -> throw new IllegalArgumentException("Unsupported senderType: " + senderType);
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(toMessageSummary(message));
    }

    /* ------------------------------------------------------------------ */
    /* Mapping helpers                                                      */
    /* ------------------------------------------------------------------ */

    private ConversationSummary toSummary(Conversation c) {
        return new ConversationSummary(
                c.getId(),
                c.getTitle(),
                c.getProviderId(),
                c.getModel(),
                c.getCreatedAt(),
                c.getUpdatedAt(),
                c.getMessages().size()
        );
    }

    private MessageSummary toMessageSummary(Message m) {
        return new MessageSummary(
                m.getId(),
                m.getSenderType().name(),
                m.getContent(),
                m.getProviderId(),
                m.getModel(),
                m.getCreatedAt()
        );
    }
}