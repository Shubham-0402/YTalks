package com.ytalks.backend.controller;

import com.ytalks.backend.entity.OtpCode;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.repository.OtpCodeRepository;
import com.ytalks.backend.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Milestone 4 end-to-end integration tests for authentication, OTP verification,
 * JWT protection, user profile, conversation management, message persistence,
 * and cross-user ownership isolation.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthAndConversationIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private OtpCodeRepository otpRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private String uniqueEmail(String prefix) {
        return prefix + "." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String extractJsonField(String json, String field) {
        String key = "\"" + field + "\":";
        int idx = json.indexOf(key);
        if (idx < 0) return null;
        int start = idx + key.length();
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        if (json.charAt(start) == '"') {
            int end = json.indexOf('"', start + 1);
            return json.substring(start + 1, end);
        } else {
            int end = start;
            while (end < json.length() && ",}".indexOf(json.charAt(end)) < 0) end++;
            return json.substring(start, end).trim();
        }
    }

    @Test
    @DisplayName("Full registration -> OTP verification -> BCrypt hash -> login -> /api/auth/me flow")
    void fullRegistrationOtpAndLoginFlow() throws Exception {
        String email = uniqueEmail("priya");

        // 1. Initiate registration (generates OTP)
        MvcResult regResult = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "Priya Verma",
                                  "email": "%s",
                                  "phone": "+91 98111 22333",
                                  "password": "Password@123"
                                }
                                """.formatted(email)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(jsonPath("$.devOtp", matchesPattern("\\d{6}")))
                .andReturn();

        String code = extractJsonField(regResult.getResponse().getContentAsString(), "devOtp");
        assertThat(code).matches("\\d{6}");

        // Verify OTP record exists in database with BCrypt hash (not plaintext)
        List<OtpCode> otps = otpRepository.findByEmailOrderByCreatedAtDesc(email);
        assertThat(otps).isNotEmpty();
        assertThat(otps.get(0).getOtpHash()).isNotEqualTo(code);
        assertThat(passwordEncoder.matches(code, otps.get(0).getOtpHash())).isTrue();

        // 2. Complete registration with OTP
        MvcResult verifyResult = mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "Priya Verma",
                                  "email": "%s",
                                  "phone": "+91 98111 22333",
                                  "password": "Password@123",
                                  "code": "%s"
                                }
                                """.formatted(email, code)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken", not(emptyOrNullString())))
                .andExpect(jsonPath("$.user.email", is(email)))
                .andExpect(jsonPath("$.user.name", is("Priya Verma")))
                .andReturn();

        String jwt = extractJsonField(verifyResult.getResponse().getContentAsString(), "accessToken");
        assertThat(jwt).isNotBlank();

        // 3. Verify password is stored hashed with BCrypt in database
        User savedUser = userRepository.findByEmailIgnoreCase(email).orElseThrow();
        assertThat(savedUser.getPasswordHash()).isNotEqualTo("Password@123");
        assertThat(passwordEncoder.matches("Password@123", savedUser.getPasswordHash())).isTrue();

        // 4. Verify both GET and POST /api/auth/me work with the JWT token
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email", is(email)))
                .andExpect(jsonPath("$.name", is("Priya Verma")))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        mockMvc.perform(post("/api/auth/me")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email", is(email)));

        // 5. Log in with email and password
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "%s",
                                  "password": "Password@123"
                                }
                                """.formatted(email)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken", not(emptyOrNullString())))
                .andExpect(jsonPath("$.user.email", is(email)));
    }

    @Test
    @DisplayName("Validation errors, duplicate email rejection, and invalid login credentials")
    void validationDuplicateAndInvalidCredentials() throws Exception {
        // 1. Invalid registration payload (blank name, invalid email, short password)
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "",
                                  "email": "not-an-email",
                                  "password": "short"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_FAILED")));

        // 2. Duplicate email (demo user aarav.sharma@example.com is seeded)
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "Duplicate User",
                                  "email": "aarav.sharma@example.com",
                                  "password": "Password@123"
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("EMAIL_EXISTS")));

        // 3. Invalid login password
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "aarav.sharma@example.com",
                                  "password": "WrongPassword123"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code", is("INVALID_CREDENTIALS")));
    }

    @Test
    @DisplayName("OTP security: wrong code increments attempts, 3 wrong attempts lock out, expired OTP rejected, resend works")
    void otpAttemptsLockoutExpirationAndResend() throws Exception {
        String email = uniqueEmail("otp.security");

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "OTP Tester",
                                  "email": "%s",
                                  "password": "Password@123"
                                }
                                """.formatted(email)))
                .andExpect(status().isOk());

        // Attempt 1 with wrong code -> 400 INVALID_OTP
        mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "OTP Tester",
                                  "email": "%s",
                                  "password": "Password@123",
                                  "code": "000000"
                                }
                                """.formatted(email)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_OTP")));
        assertThat(otpRepository.findByEmailOrderByCreatedAtDesc(email).get(0).getAttempts()).isEqualTo(1);

        // Attempt 2 with wrong code -> 400 INVALID_OTP
        mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "OTP Tester",
                                  "email": "%s",
                                  "password": "Password@123",
                                  "code": "000000"
                                }
                                """.formatted(email)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_OTP")));
        assertThat(otpRepository.findByEmailOrderByCreatedAtDesc(email).get(0).getAttempts()).isEqualTo(2);

        // Attempt 3 with wrong code -> 429 OTP_MAX_ATTEMPTS
        mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "OTP Tester",
                                  "email": "%s",
                                  "password": "Password@123",
                                  "code": "000000"
                                }
                                """.formatted(email)))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code", is("OTP_MAX_ATTEMPTS")));
        assertThat(otpRepository.findByEmailOrderByCreatedAtDesc(email).get(0).getAttempts()).isEqualTo(3);

        // Resend OTP issues a fresh valid code
        MvcResult resendResult = mockMvc.perform(post("/api/auth/resend-otp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "%s"
                                }
                                """.formatted(email)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.devOtp", matchesPattern("\\d{6}")))
                .andReturn();

        String newCode = extractJsonField(resendResult.getResponse().getContentAsString(), "devOtp");
        OtpCode latestOtp = otpRepository.findByEmailOrderByCreatedAtDesc(email).get(0);
        // Force expire the OTP and verify 400 OTP_EXPIRED
        latestOtp.setExpiresAt(Instant.now().minus(1, ChronoUnit.MINUTES));
        otpRepository.saveAndFlush(latestOtp);

        mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "OTP Tester",
                                  "email": "%s",
                                  "password": "Password@123",
                                  "code": "%s"
                                }
                                """.formatted(email, newCode)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("OTP_EXPIRED")));
    }

    @Test
    @DisplayName("Protected endpoints reject unauthenticated requests including /api/auth/me")
    void protectedEndpointsRejectUnauthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/auth/me"))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/conversations"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/conversations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Unauthorized\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Conversation CRUD, message ordering, partial PATCH, clear, delete, and cross-user isolation")
    void conversationAndMessagePersistenceAndOwnershipIsolation() throws Exception {
        // Log in as demo user (User A)
        MvcResult loginA = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "aarav.sharma@example.com",
                                  "password": "Demo@12345"
                                }
                                """))
                .andExpect(status().isOk())
                .andReturn();
        String tokenA = extractJsonField(loginA.getResponse().getContentAsString(), "accessToken");

        // Register & verify User B
        String emailB = uniqueEmail("userb");
        MvcResult regB = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "User B",
                                  "email": "%s",
                                  "password": "Password@123"
                                }
                                """.formatted(emailB)))
                .andExpect(status().isOk())
                .andReturn();
        String otpB = extractJsonField(regB.getResponse().getContentAsString(), "devOtp");
        MvcResult verifyB = mockMvc.perform(post("/api/auth/register/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name": "User B",
                                  "email": "%s",
                                  "password": "Password@123",
                                  "code": "%s"
                                }
                                """.formatted(emailB, otpB)))
                .andExpect(status().isOk())
                .andReturn();
        String tokenB = extractJsonField(verifyB.getResponse().getContentAsString(), "accessToken");

        // User A creates a conversation
        MvcResult createConv = mockMvc.perform(post("/api/conversations")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "title": "Milestone 4 Persistence Test",
                                  "providerId": "gemini",
                                  "model": "gemini-2.5-flash"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title", is("Milestone 4 Persistence Test")))
                .andExpect(jsonPath("$.providerId", is("gemini")))
                .andExpect(jsonPath("$.model", is("gemini-2.5-flash")))
                .andReturn();

        String convId = extractJsonField(createConv.getResponse().getContentAsString(), "id");

        // User A adds USER and ASSISTANT messages
        mockMvc.perform(post("/api/conversations/" + convId + "/messages")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "senderType": "USER",
                                  "content": "First user message"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.senderType", is("USER")))
                .andExpect(jsonPath("$.content", is("First user message")));

        mockMvc.perform(post("/api/conversations/" + convId + "/messages")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "senderType": "ASSISTANT",
                                  "content": "First assistant response",
                                  "providerId": "gemini",
                                  "model": "gemini-2.5-flash"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.senderType", is("ASSISTANT")))
                .andExpect(jsonPath("$.providerId", is("gemini")));

        // Retrieve conversation with ordered messages
        mockMvc.perform(get("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages", hasSize(2)))
                .andExpect(jsonPath("$.messages[0].senderType", is("USER")))
                .andExpect(jsonPath("$.messages[0].content", is("First user message")))
                .andExpect(jsonPath("$.messages[1].senderType", is("ASSISTANT")))
                .andExpect(jsonPath("$.messages[1].content", is("First assistant response")));

        // Partial PATCH (rename title without sending providerId/model) preserves providerId and model
        mockMvc.perform(patch("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "title": "Renamed Conversation Title"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Renamed Conversation Title")))
                .andExpect(jsonPath("$.providerId", is("gemini")))
                .andExpect(jsonPath("$.model", is("gemini-2.5-flash")));

        // Cross-user isolation: User B cannot view, rename, add messages, clear, or delete User A's conversation
        mockMvc.perform(get("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        mockMvc.perform(patch("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Hijacked\"}"))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/conversations/" + convId + "/messages")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"senderType\":\"USER\",\"content\":\"Injected\"}"))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/conversations/" + convId + "/clear")
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        mockMvc.perform(delete("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        // User B's conversation list is empty
        mockMvc.perform(get("/api/conversations")
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        // User A clears messages
        mockMvc.perform(post("/api/conversations/" + convId + "/clear")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("New conversation")));

        mockMvc.perform(get("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages", hasSize(0)));

        // User A deletes conversation
        mockMvc.perform(delete("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/conversations/" + convId)
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNotFound());
    }
}
