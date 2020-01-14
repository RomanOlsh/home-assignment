## API:
 - /api/files - get all files
 - /api/files/size - get number of files in the system
 - /api/files/clear - clear data-base
 - /api/files/:id - get files's name, size and status

## Files for testing from test_data folder:
 - 5 images
 - 2 json files
 
## Limitations:
 - Data Server returns 200 for 3 out of 4 responses and 401 for each 4'th response
 - Client is limited to 5 requests per second
