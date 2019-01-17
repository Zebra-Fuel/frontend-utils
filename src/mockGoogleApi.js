function mockGoogleApi(formatted_address, lat, lng) {
    const location = {
        lat: jest.fn(() => lat),
        lng: jest.fn(() => lng),
    };
    const prediction =
        formatted_address != null
            ? [[{ structured_formatting: {}, description: formatted_address }]]
            : [[], 'ZERO_RESULTS'];
    const getPlacePredictions = jest.fn((_, autocompleteCallback) =>
        autocompleteCallback(...prediction),
    );
    const response = lat != null ? [[{ geometry: { location } }]] : [[{ formatted_address }], 'OK'];
    const geocode = jest.fn((_, callback) => callback(...response));
    return {
        maps: {
            GeocoderStatus: {},
            Geocoder: jest.fn(() => ({ geocode })),
            places: {
                AutocompleteService: jest.fn(() => ({ getPlacePredictions })),
                PlacesServiceStatus: {},
            },
        },
    };
}

module.exports = mockGoogleApi;
