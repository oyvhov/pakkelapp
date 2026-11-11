package app

import (
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/search"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// Klientsøk får berre bruke synlege felt på sjølve samlinga. Relasjonssøk kan
// elles røpe skjulte rader gjennom negative vilkår, sjølv om svaret er filtrert.
func validateClientQuery(collection *core.Collection, query map[string]string) error {
	fields := make([]string, 0, len(collection.Fields))
	for _, field := range collection.Fields {
		if !field.GetHidden() {
			fields = append(fields, field.GetName())
		}
	}
	resolver := search.NewSimpleFieldResolver(fields...)
	if filter := query["filter"]; filter != "" {
		if _, err := search.FilterData(filter).BuildExpr(resolver); err != nil {
			return err
		}
	}
	if sort := query["sort"]; sort != "" {
		for _, field := range search.ParseSortFromString(sort) {
			if _, err := field.BuildExpr(resolver); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateCollectionQuery(e *core.RequestEvent) error {
	parts := strings.Split(strings.Trim(e.Request.URL.Path, "/"), "/")
	if (e.Request.Method == "GET" || e.Request.Method == "HEAD") && len(parts) == 4 && parts[0] == "api" && parts[1] == "collections" && parts[3] == "records" && !e.HasSuperuserAuth() {
		collection, err := e.App.FindCollectionByNameOrId(parts[2])
		if err != nil {
			return e.NotFoundError("Ukjend liste.", nil)
		}
		info, err := e.RequestInfo()
		if err != nil {
			return err
		}
		if err := validateClientQuery(collection, info.Query); err != nil {
			return e.BadRequestError("Søket kan berre bruke felt på denne lista.", nil)
		}
	}
	return e.Next()
}

func registerPrivacyHooks(pb *pocketbase.PocketBase) {
	pb.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if !e.HasSuperuserAuth() {
			// Bruk same normalisering som PocketBase, også for URL-koda options.
			client := subscriptions.NewDefaultClient()
			client.Subscribe(e.Subscriptions...)
			for topic, options := range client.Subscriptions() {
				name := strings.SplitN(topic, "/", 2)[0]
				collection, err := e.App.FindCollectionByNameOrId(name)
				if err != nil {
					return e.BadRequestError("Ukjend liste.", nil)
				}
				if err := validateClientQuery(collection, options.Query); err != nil {
					return e.BadRequestError("Søket kan berre bruke felt på denne lista.", nil)
				}
			}
		}
		return e.Next()
	})

	pb.OnRecordEnrich("lists").BindFunc(func(e *core.RecordEnrichEvent) error {
		e.Record.Hide("share_token")
		if e.RequestInfo != nil && e.RequestInfo.Auth != nil && e.Record.GetString("owner") == e.RequestInfo.Auth.Id {
			e.Record.Unhide("share_token")
		}
		return e.Next()
	})
}
