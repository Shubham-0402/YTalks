package com.ytalks.backend.exception;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ValidationErrorTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("invalid request bodies come back as 400 with per-field messages")
    void invalidBodyListsFieldErrors() throws Exception {
        mockMvc.perform(post("/__test/echo")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"this message is definitely far too long\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_FAILED")))
                .andExpect(jsonPath("$.fieldErrors", hasSize(1)))
                .andExpect(jsonPath("$.fieldErrors[0].field", is("message")))
                .andExpect(jsonPath("$.fieldErrors[0].message", is("message must be 10 characters or fewer")));
    }

    @Test
    @DisplayName("a blank field is rejected too")
    void blankFieldIsRejected() throws Exception {
        mockMvc.perform(post("/__test/echo")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_FAILED")))
                .andExpect(jsonPath("$.fieldErrors[0].message", is("message must not be blank")));
    }

    @Test
    @DisplayName("malformed JSON is reported as a plain 400, not a stack trace")
    void malformedJsonIsSafe() throws Exception {
        mockMvc.perform(post("/__test/echo")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("BAD_REQUEST")))
                .andExpect(jsonPath("$.message", is("The request could not be read or parsed")));
    }
}
