package com.ytalks.backend.service;

import com.ytalks.backend.entity.OtpCode;
import com.ytalks.backend.exception.AuthException;
import com.ytalks.backend.repository.OtpCodeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Optional;

import static com.ytalks.backend.exception.AuthException.invalidOtp;
import static com.ytalks.backend.exception.AuthException.otpExpired;
import static com.ytalks.backend.exception.AuthException.otpMaxAttempts;

/**
 * Service for OTP (One-Time Password) operations.
 * <p>
 * Handles generation, storage, verification, and delivery of OTP codes.
 * OTPs are 6-digit numeric codes, hashed with BCrypt before storage.
 * In development mode, OTPs are logged instead of sent via email/SMS.
 */
@Service
@Transactional
public class OtpService {

    private static final Logger log = LoggerFactory.getLogger(OtpService.class);

    private static final int OTP_LENGTH = 6;
    private static final int OTP_EXPIRY_MINUTES = 10;
    private static final int MAX_ATTEMPTS = 3;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository otpRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${ytalks.otp.dev-mode:true}")
    private boolean devMode;

    @Value("${ytalks.otp.email.enabled:false}")
    private boolean emailEnabled;

    public OtpService(OtpCodeRepository otpRepository, PasswordEncoder passwordEncoder) {
        this.otpRepository = otpRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Generates and stores a new OTP for the given email.
     * Invalidates any existing unverified OTPs for the same email.
     *
     * @return the plain OTP code (only returned in dev mode; in production this would be sent via email/SMS)
     */
    public String generateAndStoreOtp(String email) {
        // Delete any existing OTPs for this email
        otpRepository.deleteByEmail(email);

        // Generate 6-digit OTP
        String otp = String.format("%06d", RANDOM.nextInt(1_000_000));
        String otpHash = passwordEncoder.encode(otp);

        OtpCode otpCode = new OtpCode();
        otpCode.setEmail(email.toLowerCase());
        otpCode.setOtpHash(otpHash);
        otpCode.setExpiresAt(Instant.now().plusSeconds(OTP_EXPIRY_MINUTES * 60L));
        otpRepository.save(otpCode);

        // In dev mode, log the OTP for testing
        if (devMode) {
            log.info("DEV MODE OTP for {}: {}", email, otp);
        } else if (emailEnabled) {
            // TODO: Integrate with real email provider (SendGrid, AWS SES, etc.)
            sendOtpEmail(email, otp);
        } else {
            log.warn("OTP generated but no delivery method configured (devMode={}, emailEnabled={})", devMode, emailEnabled);
        }

        return devMode ? otp : null;
    }

    /**
     * Verifies an OTP code for the given email.
     * Returns true if valid, throws AuthException if invalid/expired/max attempts.
     */
    public boolean verifyOtp(String email, String code) {
        Optional<OtpCode> otpOpt = otpRepository.findLatestValidByEmail(email.toLowerCase(), Instant.now());

        if (otpOpt.isEmpty()) {
            throw new com.ytalks.backend.exception.AuthException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_OTP", "Invalid or expired OTP code");
        }

        OtpCode otp = otpOpt.get();

        if (otp.isExpired()) {
            throw otpExpired();
        }

        if (otp.isVerified()) {
            throw new com.ytalks.backend.exception.AuthException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "OTP_ALREADY_USED", "This OTP has already been used");
        }

        if (otp.getAttempts() >= MAX_ATTEMPTS) {
            throw otpMaxAttempts();
        }

        otp.incrementAttempts();
        otpRepository.save(otp);

        if (!passwordEncoder.matches(code, otp.getOtpHash())) {
            throw invalidOtp();
        }

        // Mark as verified
        otp.setVerified(true);
        otpRepository.save(otp);

        return true;
    }

    /**
     * Checks if an email has a verified OTP (account can be activated).
     */
    public boolean hasVerifiedOtp(String email) {
        return otpRepository.findLatestValidByEmail(email.toLowerCase(), Instant.now())
                .map(OtpCode::isVerified)
                .orElse(false);
    }

    /**
     * Cleans up expired OTPs from the database.
     * Can be called periodically or on startup.
     */
    public int cleanupExpired() {
        int deleted = otpRepository.deleteExpired(Instant.now());
        if (deleted > 0) {
            log.debug("Cleaned up {} expired OTP codes", deleted);
        }
        return deleted;
    }

    /**
     * Placeholder for real email delivery.
     * In production, integrate with SendGrid, AWS SES, etc.
     */
    private void sendOtpEmail(String email, String otp) {
        // TODO: Implement real email sending
        log.info("Would send OTP email to {}: {}", email, otp);
    }
}