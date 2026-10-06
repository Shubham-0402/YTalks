package com.ytalks.backend.repository;

import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@link Conversation} entities.
 */
@Repository
public interface ConversationRepository extends JpaRepository<Conversation, Long> {

    /**
     * Finds all conversations for a user, ordered by most recently updated first.
     */
    List<Conversation> findByUserOrderByUpdatedAtDesc(User user);

    /**
     * Finds all conversations for a user with pagination.
     */
    Page<Conversation> findByUserOrderByUpdatedAtDesc(User user, Pageable pageable);

    /**
     * Finds a conversation by ID and user (ensures ownership).
     */
    @Query("SELECT c FROM Conversation c WHERE c.id = :id AND c.user = :user")
    Optional<Conversation> findByIdAndUser(Long id, User user);
}