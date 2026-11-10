package com.ytalks.backend.service;

import com.google.genai.types.Content;
import com.ytalks.backend.config.GeminiProperties;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.exception.GeminiNotConfiguredException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GeminiServiceTest {

    private GeminiProperties properties;
    private GeminiService geminiService;

    @BeforeEach
    void setUp() {
        properties = new GeminiProperties();
        geminiService = new GeminiService(properties);
    }

    @Test
    @DisplayName("isConfigured returns false when GEMINI_API_KEY is not set")
    void unconfiguredWhenNoApiKey() {
        properties.setApiKey(null);
        assertThat(geminiService.isConfigured()).isFalse();

        properties.setApiKey("   ");
        assertThat(geminiService.isConfigured()).isFalse();

        properties.setApiKey("your-gemini-api-key-here");
        assertThat(geminiService.isConfigured()).isFalse();
    }

    @Test
    @DisplayName("GeminiProperties trims whitespace and surrounding quotes on apiKey and model")
    void propertiesTrimsQuotesAndWhitespace() {
        properties.setApiKey("  \"test-key-123\"  ");
        properties.setModel("  'gemini-2.5-flash'  ");
        assertThat(properties.getApiKey()).isEqualTo("test-key-123");
        assertThat(properties.getModel()).isEqualTo("gemini-2.5-flash");
        assertThat(properties.isConfigured()).isTrue();
    }

    @Test
    @DisplayName("sendMessage throws GeminiNotConfiguredException when apiKey is missing")
    void throwsWhenSendingWithoutConfig() {
        properties.setApiKey(null);
        List<Message> messages = List.of(createMessage(SenderType.USER, "Hello"));

        assertThatThrownBy(() -> geminiService.sendMessage(messages))
                .isInstanceOf(GeminiNotConfiguredException.class)
                .hasMessageContaining("not configured");
    }

    @Test
    @DisplayName("getModel returns configured model or default")
    void returnsModel() {
        assertThat(geminiService.getModel()).isEqualTo("gemini-1.5-flash");

        properties.setModel("gemini-1.5-pro");
        assertThat(geminiService.getModel()).isEqualTo("gemini-1.5-pro");
    }

    @Test
    @DisplayName("buildConversationHistory correctly converts user and assistant messages into alternating Gemini turns")
    void buildConversationHistoryAlternating() {
        List<Message> messages = new ArrayList<>();
        messages.add(createMessage(SenderType.USER, "Hello Gemini"));
        messages.add(createMessage(SenderType.ASSISTANT, "Hello! How can I help you today?"));
        messages.add(createMessage(SenderType.USER, "Write a Java hello world"));

        List<Content> contents = geminiService.buildConversationHistory(messages);

        assertThat(contents).hasSize(3);
        assertThat(contents.get(0).role().orElse("")).isEqualTo("user");
        assertThat(contents.get(1).role().orElse("")).isEqualTo("model");
        assertThat(contents.get(2).role().orElse("")).isEqualTo("user");
    }

    @Test
    @DisplayName("buildConversationHistory coalesces consecutive messages with the same role")
    void buildConversationHistoryCoalescesSameRole() {
        List<Message> messages = new ArrayList<>();
        messages.add(createMessage(SenderType.SYSTEM, "Context transferred from OpenAI"));
        messages.add(createMessage(SenderType.USER, "First question"));
        messages.add(createMessage(SenderType.USER, "Second question right after"));
        messages.add(createMessage(SenderType.ASSISTANT, "Answer to both"));

        List<Content> contents = geminiService.buildConversationHistory(messages);

        // System + User + User are all mapped to user role and merged into 1 Content block
        // Assistant is mapped to model role
        assertThat(contents).hasSize(2);
        assertThat(contents.get(0).role().orElse("")).isEqualTo("user");
        assertThat(contents.get(1).role().orElse("")).isEqualTo("model");
    }

    @Test
    @DisplayName("buildConversationHistory ensures the first turn is always from role 'user'")
    void buildConversationHistoryStartsFromUser() {
        List<Message> messages = new ArrayList<>();
        messages.add(createMessage(SenderType.ASSISTANT, "Dangling assistant message"));
        messages.add(createMessage(SenderType.USER, "User follows up"));

        List<Content> contents = geminiService.buildConversationHistory(messages);

        assertThat(contents).hasSize(1);
        assertThat(contents.get(0).role().orElse("")).isEqualTo("user");
    }

    @Test
    @DisplayName("buildConversationHistory caps history to respect context limits")
    void buildConversationHistoryCapsHistory() {
        List<Message> messages = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            messages.add(createMessage(i % 2 == 0 ? SenderType.USER : SenderType.ASSISTANT, "Message " + i));
        }

        List<Content> contents = geminiService.buildConversationHistory(messages);

        // MAX_HISTORY_MESSAGES is 40, so contents length should be at most 40
        assertThat(contents.size()).isLessThanOrEqualTo(40);
        assertThat(contents.get(0).role().orElse("")).isEqualTo("user");
    }

    private Message createMessage(SenderType senderType, String content) {
        Message message = new Message();
        message.setSenderType(senderType);
        message.setContent(content);
        message.setCreatedAt(Instant.now());
        return message;
    }
}

