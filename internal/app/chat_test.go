package app

import (
	"slices"
	"testing"
)

func TestChatAudiencePlanReachesCoGiversNotRecipient(t *testing.T) {
	got := chatAudience(chatThread{Author: "bo", Owner: "anna", Creator: "anna", Givers: []string{"anna", "bo"}, Receivers: []string{"kari"}})
	if !slices.Equal(got, []string{"anna"}) {
		t.Fatalf("fekk %v", got)
	}
}

func TestChatAudienceNeverReachesRecipientEvenIfGiverOrEarlier(t *testing.T) {
	got := chatAudience(chatThread{Author: "a", Owner: "kari", Givers: []string{"kari", "b"}, Earlier: []string{"kari", "c"}, Receivers: []string{"kari"}})
	if slices.Contains(got, "kari") || !slices.Equal(got, []string{"b", "c"}) {
		t.Fatalf("fekk %v", got)
	}
}

func TestChatAudienceWishSkipsWisherAndOwner(t *testing.T) {
	got := chatAudience(chatThread{Wish: true, Author: "a", Owner: "anne", Creator: "anne", Wisher: "anne", Claimers: []string{"b", "a", ""}, Earlier: []string{"anne", "c"}})
	if !slices.Equal(got, []string{"b", "c"}) {
		t.Fatalf("fekk %v", got)
	}
}

func TestChatAudienceNoDuplicatesOrAuthor(t *testing.T) {
	got := chatAudience(chatThread{Author: "a", Owner: "a", Creator: "b", Givers: []string{"b", "c", "c"}, Earlier: []string{"a", "b", "c", "d"}})
	if !slices.Equal(got, []string{"b", "c", "d"}) {
		t.Fatalf("fekk %v", got)
	}
}
