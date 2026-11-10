package com.ytalks.backend.controller;

import com.ytalks.backend.dto.*;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.ApiException;
import com.ytalks.backend.exception.ResourceNotFoundException;
import com.ytalks.backend.security.UserPrincipal;
import com.ytalks.backend.service.ConversationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

/**
 * REST endpoints for conversation and message persistence.
 * <p>
 * All endpoints are protected by JWT authentication.
 * The authenticated user is obtained from the security context.
 */
@RestController
@RequestMapping("/api/conversations")
public class ConversationController {

    private static final Logger log = LoggerFactory.getLogger(ConversationController.class);

    private final ConversationService conversationService;

    public ConversationController(ConversationService conversationService) {
        this.conversationService = conversationService;
    }

    private User getCurrentUser(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        if (userPrincipal == null || userPrincipal.getUser() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required");
        }
        return userPrincipal.getUser();
    }

    /* ------------------------------------------------------------------ */
    /* Conversation list & creation                                         */
    /* ------------------------------------------------------------------ */

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<ConversationSummary>> listConversations(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        User user = getCurrentUser(userPrincipal);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "updatedAt"));
        Page<Conversation> conversationsPage = conversationService.findByUser(user, pageable);

        List<ConversationSummary> summaries = conversationsPage.getContent().stream()
                .map(this::toSummary)
                .collect(Collectors.toList());

        return ResponseEntity.ok(summaries);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationSummary> createConversation(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @RequestBody CreateConversationRequest request) {

        User user = getCurrentUser(userPrincipal);

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
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id) {

        User user = getCurrentUser(userPrincipal);
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
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id,
            @RequestBody UpdateConversationRequest request) {

        User user = getCurrentUser(userPrincipal);
        Conversation conversation = conversationService.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResourceNotFoundException("Conversation", id.toString()));

        if (request.providerId() != null || request.model() != null) {
            String nextProvider = request.providerId() != null ? request.providerId() : conversation.getProviderId();
            String nextModel = request.model() != null ? request.model() : conversation.getModel();
            conversation = conversationService.updateProvider(id, user, nextProvider, nextModel);
        }

        if (request.title() != null && !request.title().isBlank()) {
            conversation = conversationService.updateTitle(id, user, request.title().trim());
        }

        return ResponseEntity.ok(toSummary(conversation));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteConversation(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id) {

        User user = getCurrentUser(userPrincipal);
        conversationService.deleteConversation(id, user);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/{id}/clear", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConversationSummary> clearConversation(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id) {

        User user = getCurrentUser(userPrincipal);
        Conversation conversation = conversationService.clearConversation(id, user);
        return ResponseEntity.ok(toSummary(conversation));
    }

    /* ------------------------------------------------------------------ */
    /* Messages                                                             */
    /* ------------------------------------------------------------------ */

    @GetMapping(value = "/{id}/messages", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<MessageSummary>> getMessages(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        User user = getCurrentUser(userPrincipal);
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
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long id,
            @RequestBody AddMessageRequest request) {

        User user = getCurrentUser(userPrincipal);
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