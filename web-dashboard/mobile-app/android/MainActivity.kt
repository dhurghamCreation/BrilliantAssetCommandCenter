package com.brilliant.app

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET

// 1. Define the Data Structure
data class GoStats(
    val total_tasks: Int,
    val system_health: String,
    val uptime: String
)

// 2. Define the Interface
interface GoApi {
    @GET("api/stats")
    suspend fun getStats(): GoStats
}

// 3. The Function
fun fetchEngineData() {
    val retrofit = Retrofit.Builder()
        .baseUrl("http://10.0.2.2:8080/") // Use 10.0.2.2 for Android Emulator
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val api = retrofit.create(GoApi::class.java)
    // The red lines are now gone!
}