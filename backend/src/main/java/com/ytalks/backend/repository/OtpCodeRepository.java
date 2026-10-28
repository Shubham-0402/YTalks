package com.ytalks.backend.repository;

import com.ytalks.backend.entity.OtpCode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Repository for {@link OtpCode} entities.
 */
@Repository
public interface OtpCodeRepository extends JpaRepository<OtpCode, Long> {

    /**
     * Finds the most recent unverified, non-expired OTP for an email.
     */
    @Query("SELECT o FROM OtpCode o WHERE o.email = :email AND o.verified = false AND o.expiresAt > :now ORDER BY o.createdAt DESC")
    Optional<OtpCode> findLatestValidByEmail(String email, Instant now);

    /**
     * Finds all OTPs for an email (for cleanup/debugging).
     */
    List<OtpCode> findByEmailOrderByCreatedAtDesc(String email);

    /**
     * Deletes all expired OTPs (cleanup).
     */
    @Modifying
    @Transactional
    @Query("DELETE FROM OtpCode o WHERE o.expiresAt < :now")
    int deleteExpired(Instant now);

    /**
     * Deletes all OTPs for an email (used when resending or after verification).
     */
    @Modifying
    @Transactional
    @Query("DELETE FROM OtpCode o WHERE o.email = :email")
    void deleteByEmail(String email);
}