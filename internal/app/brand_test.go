package app

import (
	"testing"
	"time"
)

func TestIsJulDate(t *testing.T) {
	cases := map[string]bool{
		"2026-10-31T22:59:00Z": false, // 23:59 i Noreg 31. oktober
		"2026-10-31T23:00:00Z": true,  // midnatt i Noreg 1. november
		"2026-12-24T12:00:00Z": true,
		"2026-12-26T22:59:00Z": true,
		"2026-12-26T23:00:00Z": false, // 27. desember i Noreg
		"2027-06-01T12:00:00Z": false,
	}
	for in, want := range cases {
		at, _ := time.Parse(time.RFC3339, in)
		if got := isJulDate(at); got != want {
			t.Errorf("isJulDate(%s) = %v, vil ha %v", in, got, want)
		}
	}
	if festName("icon-192.png") != "icon-192-fest.png" || festName("favicon.svg") != "favicon-fest.svg" {
		t.Error("feil namn på festvariant")
	}
}
