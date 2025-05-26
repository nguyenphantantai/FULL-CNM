// src/hooks/useChat.js
import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { io } from "socket.io-client"

// --- Constants and Socket Setup (Outside Hook) ---

// API URL cơ sở
const API_BASE_URL = "http://localhost:5000"

// Tạo kết nối socket.io với cấu hình phù hợp
const socket = io(API_BASE_URL, {
  autoConnect: false, // Don't connect automatically, wait for initializeSocket
  reconnection: true,
  reconnectionAttempts: Number.POSITIVE_INFINITY,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ["websocket"],
  upgrade: false,
  forceNew: false, // Changed to false to prevent multiple connections
  query: {
    timestamp: Date.now(),
  },
})

// Debug socket connection (Initial setup outside hook)
socket.on("connect", () => {
  console.log("Socket connected successfully! ID:", socket.id)
})

socket.on("connect_error", (err) => {
  console.error("Socket connection error:", err)
})

socket.on("disconnect", (reason) => {
  console.log("Socket disconnected:", reason)
})

socket.on("error", (err) => {
  console.error("Socket error:", err)
})

socket.on("reconnect_error", (err) => {
  console.error("Socket reconnection error:", err)
})

// Chặn lỗi "Could not establish connection" từ Chrome
if (typeof window !== "undefined") {
  const originalConsoleError = console.error
  console.error = (...args) => {
    if (
      args[0] &&
      typeof args[0] === "string" &&
      (args[0].includes("Could not establish connection") || args[0].includes("Receiving end does not exist"))
    ) {
      return
    }
    originalConsoleError.apply(console, args)
  }
}

// --- Custom Hook ---

const useChat = () => {
  const navigate = useNavigate()

  // State Management
  const [user, setUser] = useState({ id: "", name: "User", avatar: "" })
  const [contacts, setContacts] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedContact, setSelectedContact] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState("")
  const [isConnected, setIsConnected] = useState(socket.connected) // Initial state from socket
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [mediaFiles, setMediaFiles] = useState([])
  const [documents, setDocuments] = useState([])
  const [showMedia, setShowMedia] = useState(true)
  const [showFiles, setShowFiles] = useState(false)
  const [activeTab, setActiveTab] = useState("chat")
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileData, setProfileData] = useState({
    fullName: "",
    birthdate: "",
    gender: "",
    avatarUrl: null,
  })
  const [loading, setLoading] = useState(false)
  const [showAddFriendModal, setShowAddFriendModal] = useState(false)
  const [friendEmail, setFriendEmail] = useState("")
  const [error, setError] = useState(null)
  const [showToast, setShowToast] = useState(false)
  const [friendRequests, setFriendRequests] = useState([])
  const [recoveredContacts, setRecoveredContacts] = useState([]) // Keep for recovery logic
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState(null)
  // Thêm state lưu cache tin nhắn theo conversationId
  const [cachedMessages, setCachedMessages] = useState({})

  // Refs (Keep refs needed by the UI component)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const videoInputRef = useRef(null)

  // --- Utility Functions ---

  const showError = useCallback((message) => {
    console.log("Showing Toast:", message)
    setError(message)
    setShowToast(true)
    // Automatically hide toast after 3 seconds (optional, if Toast component doesn't autohide)
    // setTimeout(() => setShowToast(false), 3000);
  }, [])

  const apiCall = useCallback(
    async (method, url, data = null, token) => {
      try {
        console.log(`API Call: ${method.toUpperCase()} ${url}`)
        if (data) {
          console.log("Request data:", data instanceof FormData ? "FormData" : data)
        }

        const config = {
          method,
          url: `${API_BASE_URL}${url}`,
          headers: {
            Authorization: `Bearer ${token}`,
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            "If-None-Match": "", // Prevent 304 responses
          },
          data,
        }

        if (!(data instanceof FormData)) {
          config.headers["Content-Type"] = "application/json"
        }

        console.log("Using config:", {
          method: config.method,
          url: config.url,
          headers: { ...config.headers, Authorization: "Bearer [HIDDEN]" },
        })

        const response = await axios(config)
        console.log(`API Response ${url}:`, response.status, response.data)
        return response.data
      } catch (error) {
        console.error(`API Error ${url}:`, error)
        if (error.response) {
          console.error("Response status:", error.response.status)
          console.error("Response data:", error.response.data)
        }

        if (error.response?.status === 401) {
          localStorage.removeItem("token")
          localStorage.removeItem("userProfile") // Clear profile too
          navigate("/login")
          // Use showError for consistency
          showError("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.")
          throw new Error("Phiên đăng nhập hết hạn.") // Throw to stop further execution
        }

        const errorMessage = error.response?.data?.message || error.message || "Đã xảy ra lỗi không xác định"
        // Don't automatically show toast here, let the calling function decide
        // showError(errorMessage);
        throw new Error(errorMessage)
      }
    },
    [navigate, showError],
  ) // Add navigate and showError as dependencies

  // --- Contact and Group Management ---

  const addOrUpdateContact = useCallback((newContact) => {
    if (!newContact || !newContact.id) {
      console.error("Invalid contact data:", newContact)
      return
    }
    console.log("Adding or updating contact:", newContact)
    try {
      const savedContacts = localStorage.getItem("savedContacts")
      let contactsArray = savedContacts ? JSON.parse(savedContacts) : []
      contactsArray = contactsArray.filter((c) => c.id !== newContact.id)
      contactsArray.push(newContact)
      localStorage.setItem("savedContacts", JSON.stringify(contactsArray))
      console.log("Saved contact to localStorage:", newContact.id)
    } catch (storageError) {
      console.error("Error saving contact to localStorage:", storageError)
    }
    setContacts((prev) => {
      const exists = prev.some((contact) => contact.id === newContact.id)
      if (exists) {
        return prev.map((contact) => (contact.id === newContact.id ? { ...contact, ...newContact } : contact))
      }
      return [...prev, newContact]
    })
    // Update recoveredContacts as well if needed, or simplify recovery logic
    setRecoveredContacts((prev) => {
      const exists = prev.some((contact) => contact.id === newContact.id)
      if (exists) {
        return prev.map((contact) => (contact.id === newContact.id ? { ...contact, ...newContact } : contact))
      }
      return [...prev, newContact]
    })
  }, [])

  const addOrUpdateGroup = useCallback((newGroup) => {
    if (!newGroup || !newGroup.groupId) {
      console.error("Invalid group data:", newGroup)
      return
    }
    console.log("Adding or updating group:", newGroup)
    try {
      const savedGroups = localStorage.getItem("savedGroups")
      let groupsArray = savedGroups ? JSON.parse(savedGroups) : []
      groupsArray = groupsArray.filter((g) => g.groupId !== newGroup.groupId)
      groupsArray.push(newGroup)
      localStorage.setItem("savedGroups", JSON.stringify(groupsArray))
      console.log("Saved group to localStorage:", newGroup.groupId)
    } catch (storageError) {
      console.error("Error saving group to localStorage:", storageError)
    }
    setGroups((prev) => {
      const exists = prev.some((group) => group.groupId === newGroup.groupId)
      if (exists) {
        return prev.map((group) => (group.groupId === newGroup.groupId ? { ...group, ...newGroup } : group))
      }
      return [...prev, newGroup]
    })
  }, [])

  // --- Data Fetching ---

  const fetchUserProfile = useCallback(
    async (token) => {
      try {
        const response = await apiCall("get", "/api/users/profile", null, token)
        const userData = {
          id: response.userId,
          name: response.fullName || "User",
          avatar: response.avatarUrl || "",
        }
        setUser(userData)
        setProfileData({
          fullName: response.fullName || "",
          birthdate: response.birthdate ? new Date(response.birthdate).toISOString().split("T")[0] : "",
          gender: response.gender || "",
          avatarUrl: response.avatarUrl || null,
        })
        // Save profile to localStorage after fetching
        localStorage.setItem("userProfile", JSON.stringify(response))
        return response // Return the full profile
      } catch (error) {
        console.error("Error fetching user profile:", error)
        showError("Không thể lấy thông tin người dùng: " + error.message)
        // No need to navigate here, apiCall handles 401
        return null
      }
    },
    [apiCall, showError],
  )

  const fetchMessages = useCallback(
    async (token, conversationId, isGroup = false) => {
      if (!token || !conversationId) {
        console.warn("fetchMessages called without token or conversationId")
        setMessages([]) // Clear messages if no ID
        setMediaFiles([])
        setDocuments([])
        return
      }
      setLoading(true) // Indicate loading messages
      try {
        let response
        // Sử dụng endpoint messages/conversations cho cả tin nhắn nhóm và cá nhân
        const endpoint = `/api/messages/conversations/${conversationId}/messages`

        console.log("Fetching messages from endpoint:", endpoint)
        response = await apiCall("get", endpoint, null, token)
        console.log("Messages API response:", response)

        const messagesData = Array.isArray(response) ? response : response.data || []

        const mappedMessages = messagesData
          .map((msg, index) => ({
              id: msg.messageId || `temp-${Date.now()}-${index}`,
              sender: msg.senderId === user.id ? "Me" : msg.senderName || "Unknown",
              content:
                msg.isDeleted
                  ? "Tin nhắn đã bị xóa"
                  : msg.isRecalled
                    ? "Tin nhắn đã bị thu hồi/xóa"
                    : msg.type === "text" || msg.type === "emoji" || msg.type === "system"
                      ? msg.content
                      : msg.attachments?.[0]?.url || msg.content || "",
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              senderId: msg.senderId,
              isImage: !msg.isDeleted && (msg.type === "image" || msg.type === "imageGroup"),
              isVideo: !msg.isDeleted && msg.type === "video",
              isFile: !msg.isDeleted && msg.type === "file",
              isUnsent: msg.isRecalled || msg.isDeleted,
              isSystemMessage: msg.isSystemMessage || msg.senderId === "system",
              fileUrl: !msg.isDeleted && msg.type === "file" && msg.attachments?.length > 0 ? msg.attachments[0]?.url : null,
              fileName: !msg.isDeleted && msg.type === "file" && msg.attachments?.length > 0 ? msg.attachments[0]?.name : null,
              fileType: !msg.isDeleted && msg.type === "file" && msg.attachments?.length > 0 ? msg.attachments[0]?.type : null,
              duration: !msg.isDeleted && msg.type === "video" && msg.attachments?.length > 0 ? msg.attachments[0]?.duration : null,
              messageDate: new Date().toLocaleDateString(),
          }))
          .filter((msg) => msg.id) // Filter out messages without an ID

        // Add system message if needed
        if (mappedMessages.length === 0 || !mappedMessages.some((msg) => msg.isSystemMessage)) {
          const systemMessage = isGroup
            ? "Chào mừng bạn đến với nhóm chat!"
            : "Các bạn đã trở thành bạn bè, hãy bắt đầu cuộc trò chuyện!"
          mappedMessages.unshift({
            id: `system-${Date.now()}`,
            senderId: "system",
            content: systemMessage,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            isSystemMessage: true,
          })
        }

        // Merge thêm các tin nhắn cache (nếu có) mà chưa có trong mappedMessages
        let mergedMessages = mappedMessages
        // Lấy cache mới nhất từ localStorage thay vì chỉ lấy từ state
        const cacheFromStorage = JSON.parse(localStorage.getItem('cachedMessages') || '{}')
        const cacheList = cacheFromStorage[conversationId] || []
        console.log('Cache for this conversation:', cacheList)
        const newFromCache = cacheList.filter(
          cacheMsg => !mappedMessages.some(msg => msg.id === cacheMsg.id)
        )
        mergedMessages = [...mappedMessages, ...newFromCache]
        // Sắp xếp lại theo thời gian (nếu có trường createdAt)
        mergedMessages.sort((a, b) => {
          const aTime = new Date(a.createdAt || a.time || a.messageDate)
          const bTime = new Date(b.createdAt || b.time || b.messageDate)
          return aTime - bTime
        })
        console.log('Merged messages after cache merge:', mergedMessages)
        setMessages(mergedMessages)

        // Update Media and Documents
        const media = mappedMessages
          .filter((msg) => (msg.isImage || msg.isVideo) && !msg.isUnsent && msg.content)
          .map((msg) => ({
            id: msg.id,
            type: msg.isImage ? "image" : "video",
            url: msg.content,
            name: msg.fileName || (msg.isImage ? "image.jpg" : "video.mp4"),
            date: msg.messageDate,
            size: msg.attachments?.[0]?.size || 0, // Might not be available, default to 0
            duration: msg.duration,
          }))
        setMediaFiles(media.reverse()) // Show newest first

        const files = mappedMessages
          .filter((msg) => msg.isFile && !msg.isUnsent && msg.fileUrl)
          .map((msg) => ({
            id: msg.id,
            type: msg.fileName?.split(".").pop().toLowerCase() || "file",
            url: msg.fileUrl,
            name: msg.fileName,
            date: msg.messageDate,
            size: msg.attachments?.[0]?.size || 0,
          }))
        setDocuments(files.reverse()) // Show newest first
      } catch (error) {
        console.error("Error fetching messages:", error)
        showError("Không thể tải tin nhắn: " + error.message)
        setMessages([]) // Clear messages on error
        setMediaFiles([])
        setDocuments([])
      } finally {
        setLoading(false)
      }
    },
    [apiCall, showError, user.id], // Depend on user.id to compare sender
  )

  const fetchContactsAndGroups = useCallback(
    async (token) => {
      if (!token) return { contacts: [], groups: [] }
      setLoading(true)
      let fetchedContacts = []
      let fetchedGroups = []

      try {
        // Fetch Friends (Contacts) from server first
        console.log("Fetching friends from server...")
        const friendsResponse = await apiCall("get", "/api/friends", null, token)
        console.log("Friends API response:", friendsResponse)

        // Lọc ra những người bạn đã được xác nhận
        // API /api/friends đã được cải thiện để chỉ trả về bạn bè thực sự
        const confirmedFriends = friendsResponse?.friends || []
        console.log("Confirmed friends:", confirmedFriends)

        // Kiểm tra xem danh sách bạn bè có hợp lệ không
        const validFriends = confirmedFriends.filter(friend =>
          friend && friend.userId && friend.friendshipId
        )

        if (validFriends.length !== confirmedFriends.length) {
          console.log(`Filtered out ${confirmedFriends.length - validFriends.length} invalid friends`)
        }

        const mappedFriends = validFriends.map((friend) => ({
          id: friend.userId,
          name: friend.fullName || friend.email?.split("@")[0] || "Unknown",
          avatar: friend.avatarUrl || "",
          type: "contact",
          status: "Bạn bè", // Trạng thái mặc định
          friendshipId: friend.friendshipId, // Lưu friendshipId để dễ dàng xóa sau này
          conversationId: null, // Will be populated later
        }))

        // Fetch Conversations to get conversation IDs
        console.log("Fetching conversations...")
        const convResponse = await apiCall("get", "/api/messages/conversations", null, token)
        const conversationsMap = new Map()
        if (convResponse && Array.isArray(convResponse)) {
          convResponse.forEach((conv) => {
            if (conv.participants && conv.participants.length === 2 && conv.conversationId) {
              const otherUserId = conv.participants.find((id) => id !== user.id)
              if (otherUserId) {
                conversationsMap.set(otherUserId, conv.conversationId)
              }
            }
          })
        }

        // Update conversationId for mapped friends
        mappedFriends.forEach((friend) => {
          if (conversationsMap.has(friend.id)) {
            friend.conversationId = conversationsMap.get(friend.id)
          }
        })

        // Merge with existing contacts to preserve any additional data
        const savedContacts = JSON.parse(localStorage.getItem("savedContacts") || "[]")

        // Create a map of existing contacts for quick lookup
        const existingContactsMap = new Map()
        savedContacts.forEach(contact => {
          if (contact && contact.id) {
            existingContactsMap.set(contact.id, contact)
          }
        })

        // Merge server data with existing data, prioritizing server data
        fetchedContacts = mappedFriends.map(friend => {
          const existingContact = existingContactsMap.get(friend.id)
          if (existingContact) {
            // Preserve conversationId if it exists in saved contact but not in server data
            if (!friend.conversationId && existingContact.conversationId) {
              friend.conversationId = existingContact.conversationId
            }
            return { ...existingContact, ...friend }
          }
          return friend
        })

        // Update state and localStorage
        setContacts(fetchedContacts)
        localStorage.setItem("savedContacts", JSON.stringify(fetchedContacts))
        console.log("Updated contacts from API:", fetchedContacts.length)

        // Fetch Groups
        console.log("Fetching groups...")
        const groupsResponse = await apiCall("get", "/api/groups", null, token)
        console.log("Groups API response:", groupsResponse)

        if (groupsResponse && groupsResponse.groups) {
          // Lọc các nhóm mà người dùng là thành viên
          const userGroups = groupsResponse.groups.filter(
            (group) => group.members && group.members.some(member => member.userId === user.id)
          )
          console.log(`Filtered user groups: ${userGroups.length} out of ${groupsResponse.groups.length}`)

          fetchedGroups = userGroups.map((group) => ({
            groupId: group.groupId,
            id: group.groupId,
            name: group.name,
            avatar: group.avatarUrl || "",
            type: "group",
            adminId: group.admin,
            admin: group.admin,
            members: group.members || [], // Lưu toàn bộ thông tin thành viên
            memberIds: group.members?.map(member => member.userId) || [], // Thêm mảng memberIds để dễ kiểm tra
            memberCount: group.memberCount || group.members?.length || 0,
            conversationId: group.conversationId,
            createdAt: group.createdAt,
          }))
          setGroups(fetchedGroups)
          localStorage.setItem("savedGroups", JSON.stringify(fetchedGroups))
          console.log("Updated groups from API:", fetchedGroups.length)
        }

        return { contacts: fetchedContacts, groups: fetchedGroups }
      } catch (error) {
        console.error("Error fetching contacts/groups:", error)
        showError("Không thể tải danh bạ/nhóm: " + error.message)

        // Fallback to localStorage only if server fetch fails
        try {
          const savedContacts = JSON.parse(localStorage.getItem("savedContacts") || "[]")
          const savedGroups = JSON.parse(localStorage.getItem("savedGroups") || "[]")

          if (savedContacts.length > 0) {
            console.log("Falling back to contacts from localStorage")
            setContacts(savedContacts)
            fetchedContacts = savedContacts
          }

          if (savedGroups.length > 0) {
            console.log("Falling back to groups from localStorage")
            setGroups(savedGroups)
            fetchedGroups = savedGroups
          }
        } catch (e) {
          console.error("Error reading contacts/groups from localStorage", e)
        }

        return { contacts: fetchedContacts, groups: fetchedGroups }
      } finally {
        setLoading(false)
      }
    },
    [apiCall, showError, user.id], // Depend on user.id for conversation mapping
  )

  const fetchFriendRequests = useCallback(
    async (token) => {
      if (!token) return
      // No need for setLoading(true) here unless it's a primary action
      try {
        const response = await apiCall("get", "/api/friends/requests/received", null, token)
        setFriendRequests(response.data || [])
      } catch (error) {
        console.error("Không thể lấy danh sách lời mời kết bạn:", error)
        // showError("Lỗi tải lời mời kết bạn: " + error.message); // Optional: show error
      }
    },
    [apiCall],
  )

  // --- Conversation Handling ---

  const createOrGetConversation = useCallback(
    async (otherUserId, token) => {
      console.log(`Creating/getting conversation with user: ${otherUserId}`)
      if (!token || !otherUserId) {
        throw new Error("Token or otherUserId missing for createOrGetConversation")
      }
      try {
        const response = await apiCall("get", `/api/messages/conversations/user/${otherUserId}`, null, token)
        if (response?.conversation?.conversationId) {
          console.log("Successfully created/retrieved conversation ID:", response.conversation.conversationId)
          return response.conversation.conversationId
        } else {
          throw new Error("Invalid response structure from conversation API")
        }
      } catch (error) {
        console.error("Error in createOrGetConversation:", error)
        if (error.message.includes("403") || error.message.includes("only chat with friends")) {
          throw new Error("Bạn chỉ có thể nhắn tin với bạn bè")
        }
        throw new Error(`Không thể tạo/lấy cuộc trò chuyện: ${error.message}`) // Rethrow with context
      }
    },
    [apiCall],
  )

  // --- Contact/Group Selection ---

  const handleContactSelect = useCallback(
    async (contactOrGroup) => {
      if (!contactOrGroup || contactOrGroup.id === selectedContact?.id) {
        console.log("Selection unchanged or invalid.")
        return // Avoid re-selecting the same contact/group
      }

      const token = localStorage.getItem("token")
      if (!token) {
        showError("Vui lòng đăng nhập lại.")
        navigate("/login")
        return
      }

      console.log("Selected:", contactOrGroup.type, contactOrGroup.name, contactOrGroup.id)

      // Leave previous room
      if (selectedContact) {
        const roomToLeave =
          selectedContact.type === "group" ? selectedContact.groupId : selectedContact.conversationId
        if (roomToLeave) {
          const eventName = selectedContact.type === "group" ? "leave_group" : "leave_conversation"
          socket.emit(eventName, roomToLeave)
          console.log(`Left ${selectedContact.type} room:`, roomToLeave)
        }
      }

      // Clear previous state
      setMessages([])
      setMediaFiles([])
      setDocuments([])
      setSelectedContact(contactOrGroup) // Set selected contact immediately for UI update

      try {
        setLoading(true) // Show loading for message fetch

        if (contactOrGroup.type === "group") {
          const groupId = contactOrGroup.groupId
          // Sử dụng conversationId từ group object
          const conversationId = contactOrGroup.conversationId || groupId
          socket.emit("join_group", groupId)
          console.log("Joined group room:", groupId)
          console.log("Using conversationId for group:", conversationId)
          await fetchMessages(token, conversationId, true)
        } else {
          // Handle individual contact
          let conversationId = contactOrGroup.conversationId

          // If conversationId is missing, try to fetch/create it
          if (!conversationId) {
            console.log("Conversation ID missing, attempting to fetch/create...")
            try {
              conversationId = await createOrGetConversation(contactOrGroup.id, token)
              // Update the contact in the list and the selected contact state
              const updatedContact = { ...contactOrGroup, conversationId }
              setSelectedContact(updatedContact) // Update selected state with new ID
              setContacts((prev) => prev.map((c) => (c.id === contactOrGroup.id ? updatedContact : c)))
              // Optionally save updated contacts list to localStorage
              const currentContacts = JSON.parse(localStorage.getItem("savedContacts") || "[]")
              const updatedContactsList = currentContacts.map((c) =>
                c.id === contactOrGroup.id ? updatedContact : c,
              )
              localStorage.setItem("savedContacts", JSON.stringify(updatedContactsList))
            } catch (error) {
              showError(error.message) // Show error from createOrGetConversation
              setSelectedContact(null) // Deselect if conversation fails
              setLoading(false)
              return // Stop execution if conversation fails
            }
          }

          if (conversationId) {
            socket.emit("join_conversation", conversationId)
            console.log("Joined conversation room:", conversationId)
            await fetchMessages(token, conversationId, false)

            // Mark conversation as read with proper request body
            try {
              await apiCall("put", `/api/messages/conversations/${conversationId}/read`, { read: true }, token)

              // Update contacts list to remove unread badge
              setContacts((prev) =>
                prev.map((c) =>
                  c.id === contactOrGroup.id ? { ...c, unreadCount: 0 } : c
                )
              )
            } catch (readError) {
              console.error("Error marking conversation as read:", readError)
              // Don't show error to user since this is a non-critical operation
            }
          } else {
            // This case should ideally not be reached if createOrGetConversation throws errors
            showError("Không thể tìm thấy hoặc tạo cuộc trò chuyện.")
            setSelectedContact(null)
          }
        }
      } catch (error) {
        // Catch errors from fetchMessages or socket emits
        console.error("Error in handleContactSelect processing:", error)
        showError(`Lỗi khi chọn liên hệ: ${error.message}`)
        setSelectedContact(null) // Deselect on error
      } finally {
        setLoading(false) // Ensure loading is turned off
      }
    },
    [selectedContact, fetchMessages, createOrGetConversation, showError, navigate, apiCall, cachedMessages],
  )

  // --- Message Sending ---

  const handleSendMessage = useCallback(
    async (e) => {
      e.preventDefault()
      if (!newMessage.trim() || !isConnected || !selectedContact) return

      const token = localStorage.getItem("token")
      if (!token) {
        showError("Vui lòng đăng nhập lại.")
        return
      }

      const tempMessageId = `temp-${Date.now()}`
      const messageTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

      // Optimistic UI update
      const optimisticMessage = {
        id: tempMessageId,
        sender: "Me",
        content: newMessage,
        time: messageTime,
        senderId: user.id,
        isSending: true, // Indicate sending state
      }
      setMessages((prev) => [...prev, optimisticMessage])
      const messageToSend = newMessage // Store message before clearing
      setNewMessage("") // Clear input immediately
      scrollToBottom() // Scroll after adding optimistic message

      try {
        let response
        let messageDataForSocket

        if (selectedContact.type === "group") {
          const groupId = selectedContact.groupId
          console.log("Attempting to send group message:", {
            groupId,
            messageContent: messageToSend,
            selectedContact
          })

          if (!groupId) {
            throw new Error("GroupId is missing")
          }

          // Kiểm tra xem người dùng có phải là thành viên của nhóm không
          if (!selectedContact.memberIds?.includes(user.id)) {
            console.error("User not in group members:", {
              userId: user.id,
              memberIds: selectedContact.memberIds,
              members: selectedContact.members
            })
            throw new Error("Bạn không phải là thành viên của nhóm này")
          }

          try {
            response = await apiCall(
              "post", 
              `/api/groups/${groupId}/messages`, 
              { content: messageToSend }, 
              token
            )
            
            console.log("Group message API response:", response)
            
            if (!response) {
              throw new Error("No response from server")
            }

            if (!response.messageData) {
              console.error("Invalid response structure:", response)
              throw new Error("Invalid response structure from server")
            }
            
            const messageData = response.messageData
            messageDataForSocket = {
              messageId: messageData.messageId,
              groupId: groupId,
              senderId: user.id,
              senderName: user.name,
              content: messageToSend,
              type: "text",
              createdAt: messageData.createdAt || new Date().toISOString(),
            }

            console.log("Emitting socket event with data:", messageDataForSocket)
            socket.emit("group_message", messageDataForSocket)

            // Update optimistic message with real ID and remove sending state
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempMessageId
                  ? {
                      ...msg,
                      id: messageData.messageId,
                      isSending: false,
                      time: new Date(messageData.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    }
                  : msg
              )
            )
          } catch (error) {
            console.error("Error details:", {
              error,
              groupId,
              selectedContact,
              user: { id: user.id, name: user.name }
            })
            
            if (error.response?.status === 404) {
              throw new Error("Không tìm thấy nhóm chat")
            } else if (error.response?.status === 403) {
              throw new Error("Bạn không có quyền gửi tin nhắn trong nhóm này")
            } else {
              throw error
            }
          }
        } else {
          // Handle individual contact message sending
          const conversationId = selectedContact.conversationId
          if (!conversationId) {
            throw new Error("Không tìm thấy cuộc trò chuyện để gửi tin nhắn")
          }
          response = await apiCall(
            "post",
            "/api/messages/send/text",
            { 
              conversationId: conversationId, 
              content: messageToSend,
              tempMessageId: tempMessageId // Add tempMessageId to help match response
            },
            token
          )
          messageDataForSocket = {
            messageId: response.messageData?.messageId || response.messageId,
            tempMessageId: tempMessageId, // Include tempMessageId in socket event
            conversationId: conversationId,
            senderId: user.id,
            senderName: user.name,
            receiverId: selectedContact.id,
            content: messageToSend,
            type: "text",
            createdAt: response.messageData?.createdAt || new Date().toISOString(),
            time: messageTime // Include original time for matching
          }
          socket.emit("new_message", messageDataForSocket)
        }
      } catch (error) {
        console.error("Error sending message:", error)
        showError("Không thể gửi tin nhắn: " + error.message)
        // Remove or mark optimistic message as failed
        setMessages((prev) =>
          prev.map((msg) => (msg.id === tempMessageId ? { ...msg, isSending: false, isError: true } : msg)),
        )
      }
    },
    [newMessage, isConnected, selectedContact, apiCall, showError, user.id, user.name],
  )

  // --- File/Media Sending ---

  const handleSendFile = useCallback(
    async (file, fileType = "file") => {
      // fileType can be 'file', 'image', 'video'
      if (!file || !isConnected || !selectedContact) return

      const token = localStorage.getItem("token")
      if (!token) {
        showError("Vui lòng đăng nhập lại.")
        return
      }

      // Size/Type checks (already done in Home.jsx handlers, but good to have here too)
      const maxSize = 50 * 1024 * 1024 // 50MB
      if (file.size > maxSize) {
        showError(`File quá lớn (tối đa ${maxSize / (1024 * 1024)}MB)`)
        return
      }
      if (fileType === "image" && !file.type.startsWith("image/")) {
        showError("Chỉ chấp nhận file hình ảnh.")
        return
      }
      if (fileType === "video" && !file.type.startsWith("video/")) {
        showError("Chỉ chấp nhận file video.")
        return
      }

      // Video duration check
      let videoDuration = null
      if (fileType === "video") {
        try {
          const duration = await getVideoDuration(file)
          if (duration > 90) {
            showError("Video không được dài quá 90 giây.")
            return
          }
          videoDuration = Math.round(duration)
        } catch (err) {
          showError("Không thể đọc thông tin video.")
          return
        }
      }

      const tempMessageId = `temp-file-${Date.now()}`
      const messageTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      const tempUrl = URL.createObjectURL(file) // For optimistic UI

      // Optimistic UI update
      const optimisticMessage = {
        id: tempMessageId,
        sender: "Me",
        content: fileType === "text" ? file.name : tempUrl, // Use tempUrl for image/video
        time: messageTime,
        senderId: user.id,
        isSending: true,
        isFile: fileType === "file",
        isImage: fileType === "image",
        isVideo: fileType === "video",
        fileName: file.name,
        fileType: file.type,
        duration: videoDuration,
      }
      setMessages((prev) => [...prev, optimisticMessage])
      scrollToBottom()

      const formData = new FormData()
      let apiUrl = ""
      let apiKey = "" // Key for the file in FormData

      if (selectedContact.type === "group") {
        const groupId = selectedContact.groupId
        formData.append("groupId", groupId)
        switch (fileType) {
          case "image":
            apiUrl = `/api/groups/${groupId}/images`
            apiKey = "image" // Match backend key
            break
          case "video":
            apiUrl = `/api/groups/${groupId}/videos`
            apiKey = "video"
            break
          default: // file
            apiUrl = `/api/groups/${groupId}/files`
            apiKey = "file"
            break
        }
      } else {
        const conversationId = selectedContact.conversationId
        if (!conversationId) {
          showError("Không tìm thấy cuộc trò chuyện để gửi file")
          URL.revokeObjectURL(tempUrl)
          setMessages((prev) => prev.filter((msg) => msg.id !== tempMessageId)) // Remove optimistic msg
          return
        }
        formData.append("conversationId", conversationId)
        switch (fileType) {
          case "image":
            apiUrl = "/api/messages/send/image"
            apiKey = "images" // Match backend key (plural for this endpoint)
            break
          case "video":
            apiUrl = "/api/messages/send/video"
            apiKey = "video"
            break
          default: // file
            apiUrl = "/api/messages/send/file"
            apiKey = "file"
            break
        }
      }

      formData.append(apiKey, file)

      try {
        const response = await apiCall("post", apiUrl, formData, token)
        const messageData = response.messageData || response // Adjust based on API response structure
        const attachment = messageData.attachments?.[0]

        if (!messageData || !messageData.messageId || !attachment || !attachment.url) {
          throw new Error("Phản hồi API không hợp lệ sau khi gửi file.")
        }

        // Update optimistic message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempMessageId
              ? {
                  ...msg,
                  id: messageData.messageId,
                  content: attachment.url, // Use final URL
                  fileUrl: fileType === "file" ? attachment.url : null,
                  isSending: false,
                  time: new Date(messageData.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                }
              : msg,
          ),
        )

        // Update media/documents list
        const newItem = {
          id: messageData.messageId,
          type: fileType === "file" ? file.name.split(".").pop().toLowerCase() : fileType,
          url: attachment.url,
          name: attachment.name || file.name,
          date: new Date(messageData.createdAt).toLocaleDateString(),
          size: attachment.size || file.size,
          duration: fileType === "video" ? videoDuration || attachment.duration : null,
        }
        if (fileType === "image" || fileType === "video") {
          setMediaFiles((prev) => [newItem, ...prev]) // Add to beginning (newest)
        } else {
          setDocuments((prev) => [newItem, ...prev])
        }

        // Emit socket event
        const socketEventData = {
          messageId: messageData.messageId,
          conversationId: selectedContact.type === "group" ? null : selectedContact.conversationId,
          groupId: selectedContact.type === "group" ? selectedContact.groupId : null,
          senderId: user.id,
          senderName: user.name,
          receiverId: selectedContact.type === "group" ? null : selectedContact.id,
          type: fileType, // 'file', 'image', 'video'
          content: fileType === "file" ? `File: ${attachment.name || file.name}` : null, // Content might be null for media
          attachments: messageData.attachments,
          createdAt: messageData.createdAt || new Date().toISOString(),
          duration: fileType === "video" ? videoDuration || attachment.duration : null,
        }
        const socketEventName = selectedContact.type === "group" ? "group_message" : "new_message"
        socket.emit(socketEventName, socketEventData)

        URL.revokeObjectURL(tempUrl) // Clean up temp URL
      } catch (error) {
        console.error(`Error sending ${fileType}:`, error)
        showError(`Không thể gửi ${fileType}: ${error.message}`)
        setMessages((prev) =>
          prev.map((msg) => (msg.id === tempMessageId ? { ...msg, isSending: false, isError: true } : msg)),
        )
        URL.revokeObjectURL(tempUrl)
      }
    },
    [isConnected, selectedContact, apiCall, showError, user.id, user.name],
  )

  const getVideoDuration = (file) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        resolve(video.duration)
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        reject(new Error("Không thể tải metadata video"))
      }
      video.src = URL.createObjectURL(file)
    })
  }

  // --- Other Handlers ---

  const handleEmojiSelect = useCallback((emoji) => {
    setNewMessage((prev) => prev + emoji)
    setShowEmojiPicker(false)
  }, [])

  const handleMessageAction = useCallback(
    async (messageId, action) => {
      if (action === "delete") {
        const token = localStorage.getItem("token")
        if (!token || !selectedContact) return

        // Optimistic UI update
        const originalMessages = [...messages]
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, content: "Đang xóa...", isUnsent: true, isDeleting: true } : msg,
          ),
        )

        try {
          if (selectedContact.type === "group") {
            await apiCall("delete", `/api/groups/${selectedContact.groupId}/messages/${messageId}`, undefined, token)
          } else {
            await apiCall("delete", `/api/messages/${messageId}`, undefined, token)
          }

          // Confirm deletion in UI
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId ? { ...msg, content: "Tin nhắn đã bị xóa", isDeleting: false } : msg,
            ),
          )

          // Remove from media/documents lists
          setMediaFiles((prev) => prev.filter((media) => media.id !== messageId))
          setDocuments((prev) => prev.filter((doc) => doc.id !== messageId))

          // TODO: Emit socket event for deletion if needed by backend/other clients
        } catch (error) {
          console.error("Error deleting message:", error)
          showError("Không thể xóa tin nhắn: " + error.message)
          // Revert optimistic update on error
          setMessages(originalMessages)
        }
      }
      // Handle other actions like 'recall' if implemented
    },
    [apiCall, selectedContact, showError, messages], // Include messages in dependency array
  )

  const toggleMediaView = useCallback(() => {
    setShowMedia(true)
    setShowFiles(false)
  }, [])

  const toggleFilesView = useCallback(() => {
    setShowMedia(false)
    setShowFiles(true)
  }, [])

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    // Fetch friend requests when switching to contacts tab
    if (tab === "contacts") {
      const token = localStorage.getItem("token")
      if (token) {
        fetchFriendRequests(token)
      }
    }
  }, [fetchFriendRequests]) // Add fetchFriendRequests dependency

  const handleProfileClick = useCallback(() => {
    // Ensure profile data is current before showing modal
    const userProfile = JSON.parse(localStorage.getItem("userProfile") || "{}")
    setProfileData({
      fullName: userProfile.fullName || user.name || "",
      birthdate: userProfile.birthdate ? new Date(userProfile.birthdate).toISOString().split("T")[0] : "",
      gender: userProfile.gender || "",
      avatarUrl: userProfile.avatarUrl || user.avatar || null,
    })
    setShowProfileModal(true)
  }, [user.name, user.avatar]) // Depend on user state

  const handleCloseProfileModal = useCallback(() => {
    setShowProfileModal(false)
  }, [])

  const handleAvatarChange = useCallback(
    async (file) => {
      // File validation
      if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
        showError("Avatar không hợp lệ hoặc quá lớn (>5MB)")
        return
      }
      const token = localStorage.getItem("token")
      if (!token) return

      const formData = new FormData()
      formData.append("avatar", file)

      try {
        setLoading(true) // Indicate loading
        const response = await apiCall("post", "/api/users/avatar", formData, token)
        // Update state optimistically/realistically
        setProfileData((prev) => ({ ...prev, avatarUrl: response.avatarUrl }))
        setUser((prev) => ({ ...prev, avatar: response.avatarUrl }))
        // Update localStorage userProfile
        const userProfile = JSON.parse(localStorage.getItem("userProfile") || "{}")
        userProfile.avatarUrl = response.avatarUrl
        localStorage.setItem("userProfile", JSON.stringify(userProfile))
        showError("Cập nhật ảnh đại diện thành công!")
      } catch (error) {
        showError("Không thể tải avatar: " + error.message)
      } finally {
        setLoading(false)
      }
    },
    [apiCall, showError],
  )

  const handleUpdateProfile = useCallback(async () => {
    const token = localStorage.getItem("token")
    if (!token) return

    try {
      setLoading(true)
      const response = await apiCall(
        "put",
        "/api/users/profile",
        {
          fullName: profileData.fullName,
          // Ensure birthdate is sent correctly or omitted if empty
          birthdate: profileData.birthdate ? new Date(profileData.birthdate).toISOString() : undefined,
          gender: profileData.gender || undefined, // Send undefined if empty to potentially clear it
        },
        token,
      )
      // Update user state
      setUser((prev) => ({
        ...prev,
        name: response.fullName || prev.name,
        // Avatar might not be in this response, keep existing one
      }))
      // Update localStorage userProfile
      const userProfile = JSON.parse(localStorage.getItem("userProfile") || "{}")
      userProfile.fullName = response.fullName
      userProfile.birthdate = response.birthdate
      userProfile.gender = response.gender
      localStorage.setItem("userProfile", JSON.stringify(userProfile))

      showError("Cập nhật hồ sơ thành công!")
      handleCloseProfileModal()
    } catch (error) {
      showError("Không thể cập nhật hồ sơ: " + error.message)
    } finally {
      setLoading(false)
    }
  }, [apiCall, profileData, showError, handleCloseProfileModal])

  const handleAddFriend = useCallback(() => {
    setShowAddFriendModal(true)
  }, [])

  const handleCloseAddFriendModal = useCallback(() => {
    setShowAddFriendModal(false)
    setFriendEmail("") // Reset email field
  }, [])

  const handleSubmitAddFriend = useCallback(async () => {
    if (!friendEmail.trim()) {
      showError("Vui lòng nhập email")
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(friendEmail)) {
      showError("Email không hợp lệ.")
      return
    }

    const token = localStorage.getItem("token")
    if (!token) return

    setLoading(true)
    try {
      // Search user first to get ID
      const searchResult = await apiCall(
        "get",
        `/api/users/search?query=${encodeURIComponent(friendEmail)}`,
        null,
        token,
      )
      if (!searchResult?.data?.length) {
        throw new Error("Không tìm thấy người dùng với email này")
      }
      const receiverId = searchResult.data[0].userId

      if (receiverId === user.id) {
        throw new Error("Bạn không thể tự kết bạn với chính mình")
      }

      // Check if already friends
      if (contacts.some((c) => c.id === receiverId)) {
        throw new Error("Bạn và người này đã là bạn bè")
      }

      // Check existing sent requests (optional, backend might handle this)
      // const existingSent = await apiCall("get", `/api/friends/requests/sent`, null, token);
      // if (existingSent?.data?.some(req => req.receiver.userId === receiverId)) {
      //     throw new Error("Bạn đã gửi lời mời kết bạn cho người này rồi");
      // }

      // Send request
      await apiCall("post", "/api/friends/requests", { receiverId, message: `Kết bạn từ ${user.name}` }, token)
      showError(`Đã gửi lời mời kết bạn đến ${friendEmail}`)
      handleCloseAddFriendModal()
    } catch (error) {
      // Handle specific errors from backend if available
      if (error.message.includes("already friends")) {
        showError(`Bạn và ${friendEmail} đã là bạn bè.`)
      } else if (error.message.includes("request already sent")) {
        showError(`Bạn đã gửi lời mời kết bạn cho ${friendEmail} trước đó.`)
      } else if (error.message.includes("pending request from this user")) {
        showError(`${friendEmail} đã gửi lời mời kết bạn cho bạn. Vui lòng kiểm tra lời mời.`)
      } else {
        showError(`Lỗi: ${error.message || "Không thể gửi lời mời kết bạn"}`)
      }
      // Don't close modal on error, let user see the message
      // handleCloseAddFriendModal();
    } finally {
      setLoading(false)
    }
  }, [friendEmail, apiCall, showError, handleCloseAddFriendModal, user.name, user.id, contacts])

  const handleRespondToFriendRequest = useCallback(
    async (requestId, action) => {
      const token = localStorage.getItem("token")
      if (!token) return

      const request = friendRequests.find((req) => req.requestId === requestId)
      if (!request) return

      setLoading(true) // Indicate processing
      // Optimistically remove from list
      setFriendRequests((prev) => prev.filter((req) => req.requestId !== requestId))

      try {
        const response = await apiCall("post", "/api/friends/requests/respond", { requestId, action }, token)
        console.log("Friend request response:", response)

        if (action === "accept") {
          showError("Đã chấp nhận lời mời kết bạn")
          const senderInfo = request.sender
          if (!senderInfo || !senderInfo.userId) {
            throw new Error("Thông tin người gửi không hợp lệ")
          }

          // Get conversation ID (might be in response or need creation)
          let conversationId = response.conversation?.conversationId
          if (!conversationId) {
            console.log("No conversationId in response, creating/getting...")
            conversationId = await createOrGetConversation(senderInfo.userId, token)
          }

          if (!conversationId) {
            throw new Error("Không thể tạo hoặc lấy cuộc trò chuyện")
          }

          // Create new contact object
          const newContact = {
            id: senderInfo.userId,
            name: senderInfo.fullName || senderInfo.email?.split("@")[0] || "Unknown",
            avatar: senderInfo.avatarUrl || "",
            type: "contact",
            status: "Bạn bè",
            conversationId: conversationId,
          }

          addOrUpdateContact(newContact) // Add/update contact list and localStorage

          // Optionally select the new contact immediately
          // handleContactSelect(newContact);

          // Emit notification to the sender via socket
          if (socket.connected) {
            socket.emit("friend_request_accepted_notify", {
              accepter: { userId: user.id, fullName: user.name, avatarUrl: user.avatar },
              senderId: senderInfo.userId, // Target the sender
              conversationId: conversationId,
            })
            // Also tell sender to refresh their list
            socket.emit("refresh_contacts_notify", { targetUserId: senderInfo.userId })
            console.log("Emitted friend_request_accepted_notify and refresh_contacts_notify")
          }
        } else {
          showError("Đã từ chối lời mời kết bạn")
          // Optionally notify sender of rejection via socket
        }
      } catch (error) {
        console.error("Error responding to friend request:", error)
        showError("Không thể phản hồi lời mời: " + error.message)
        // Revert optimistic removal on error
        setFriendRequests((prev) => [...prev, request])
      } finally {
        setLoading(false)
      }
    },
    [apiCall, friendRequests, showError, createOrGetConversation, addOrUpdateContact, user],
  )

  const handleRemoveFriend = useCallback(
    async (friendId) => {
      if (!window.confirm("Bạn có chắc muốn xóa người này khỏi danh sách bạn bè không?")) {
        return
      }

      const token = localStorage.getItem("token")
      if (!token) return

      console.log(`Attempting to remove friend with ID: ${friendId}`)
      setLoading(true)

      // Lưu trữ thông tin liên hệ trước khi xóa để có thể khôi phục nếu cần
      const contactToRemove = contacts.find(contact => contact.id === friendId && contact.type === "contact")
      if (!contactToRemove) {
        showError("Không tìm thấy người dùng trong danh sách bạn bè")
        setLoading(false)
        return
      }

      // Tạo bản sao của danh sách bạn bè hiện tại để khôi phục nếu cần
      const currentContacts = [...contacts]

      try {
        // Cập nhật UI trước khi gọi API (optimistic update)
        setContacts((prev) => prev.filter((contact) => contact.id !== friendId || contact.type !== "contact"))

        // Cập nhật localStorage
        try {
          const savedContacts = JSON.parse(localStorage.getItem("savedContacts") || "[]")
          const updatedContacts = savedContacts.filter((c) => c.id !== friendId || c.type !== "contact")
          localStorage.setItem("savedContacts", JSON.stringify(updatedContacts))
        } catch (e) {
          console.error("Error updating localStorage after friend removal", e)
        }

        // Bỏ chọn nếu đang được chọn
        if (selectedContact?.id === friendId && selectedContact?.type === "contact") {
          setSelectedContact(null)
          setMessages([])
          setMediaFiles([])
          setDocuments([])
        }

        // Gọi API để xóa bạn bè
        try {
          console.log(`Calling API to remove friend: ${friendId}`)
          const response = await apiCall("delete", `/api/friends/${friendId}`, undefined, token)
          console.log("Friend removal API response:", response)

          showError("Đã xóa bạn bè thành công")

          // Thông báo cho người bạn bị xóa qua socket
          if (socket && socket.connected) {
            socket.emit("friend_removed_notify", { removerId: user.id, removedUserId: friendId })
            console.log("Emitted friend_removed_notify")

            // Thông báo cập nhật danh sách bạn bè
            socket.emit("friend_list_updated")
          }

          // Cập nhật lại danh sách bạn bè từ server
          fetchContactsAndGroups(token)
        } catch (apiError) {
          console.error("API error removing friend:", apiError)

          // Kiểm tra lỗi cụ thể
          if (apiError.response && apiError.response.status === 404) {
            // Nếu lỗi là "Friendship not found", có thể bạn bè đã bị xóa trước đó
            showError("Mối quan hệ bạn bè không tồn tại hoặc đã bị xóa trước đó")
            // Cập nhật lại danh sách bạn bè từ server
            fetchContactsAndGroups(token)
          } else {
            // Đối với các lỗi khác, hiển thị thông báo và khôi phục UI
            showError("Lỗi khi xóa bạn bè: " + (apiError.message || "Lỗi không xác định"))
            // Khôi phục lại danh sách bạn bè
            setContacts(currentContacts)

            // Khôi phục localStorage
            try {
              localStorage.setItem("savedContacts", JSON.stringify(currentContacts))
            } catch (e) {
              console.error("Error restoring localStorage", e)
            }
          }
        }
      } catch (error) {
        console.error("Error in handleRemoveFriend:", error)
        showError("Không thể xóa bạn bè: " + error.message)

        // Khôi phục lại danh sách bạn bè
        setContacts(currentContacts)

        // Khôi phục localStorage
        try {
          localStorage.setItem("savedContacts", JSON.stringify(currentContacts))
        } catch (e) {
          console.error("Error restoring localStorage", e)
        }
      } finally {
        setLoading(false)
      }
    },
    [apiCall, showError, selectedContact, user.id, contacts, fetchContactsAndGroups],
  )

  // --- Group Handlers ---
  const handleCreateGroup = useCallback(() => {
    setShowCreateGroupModal(true)
  }, [])

  const handleGroupCreated = useCallback(
    (newGroupData) => {
      console.log("Group created data:", newGroupData)
      const groupObject = {
        groupId: newGroupData.groupId,
        id: newGroupData.groupId, // Add id for consistency
        name: newGroupData.name,
        avatar: newGroupData.avatarUrl || "",
        type: "group",
        adminId: newGroupData.adminId,
        memberCount: newGroupData.members?.length || 1, // At least admin is a member
        conversationId: newGroupData.conversationId || newGroupData.groupId,
        createdAt: newGroupData.createdAt,
      }
      addOrUpdateGroup(groupObject)
      setShowCreateGroupModal(false)
      showError(`Đã tạo nhóm "${newGroupData.name}" thành công`)
      // Automatically select the new group
      handleContactSelect(groupObject)
    },
    [addOrUpdateGroup, showError, handleContactSelect],
  )

  const handleGroupInfo = useCallback(
    (group) => {
      // Fetch full group details if necessary before showing modal
      setSelectedGroup(group) // Pass the basic group info for now
      setShowGroupInfoModal(true)
      // TODO: Optionally fetch full member list etc. inside GroupInfoModal or here
    },
    [], // No dependencies needed to just show the modal
  )

  const handleGroupUpdated = useCallback(
    (updatedGroupData) => {
      console.log("Group updated data:", updatedGroupData)
      // Ensure the data structure matches what addOrUpdateGroup expects
      const groupObject = {
        groupId: updatedGroupData.groupId,
        id: updatedGroupData.groupId,
        name: updatedGroupData.name,
        avatar: updatedGroupData.avatarUrl || "",
        type: "group",
        adminId: updatedGroupData.adminId,
        memberCount: updatedGroupData.memberCount || updatedGroupData.members?.length || 0,
        conversationId: updatedGroupData.conversationId || updatedGroupData.groupId,
        createdAt: updatedGroupData.createdAt,
        // Include other relevant fields if needed
      }
      addOrUpdateGroup(groupObject)
      // Update selected contact if it's the one being edited
      if (selectedContact?.id === groupObject.groupId && selectedContact?.type === "group") {
        setSelectedContact(groupObject)
      }
      setShowGroupInfoModal(false) // Close modal on success
      showError(`Đã cập nhật thông tin nhóm "${groupObject.name}"`)
    },
    [addOrUpdateGroup, selectedContact, showError],
  )

  const handleLeaveGroup = useCallback(
    async (groupId) => {
      console.log("Leaving group:", groupId)

      if (!window.confirm("Bạn có chắc muốn rời khỏi nhóm này không?")) {
        return
      }

      const token = localStorage.getItem("token")
      if (!token) return

      setLoading(true)

      try {
        // Gọi API để rời nhóm
        const response = await apiCall("delete", `/api/groups/${groupId}/leave`, undefined, token)
        console.log("Leave group API response:", response)

        // Cập nhật UI sau khi API thành công
        setGroups((prev) => prev.filter((group) => group.groupId !== groupId))

        // Cập nhật localStorage
        try {
          const savedGroups = JSON.parse(localStorage.getItem("savedGroups") || "[]")
          const updatedGroups = savedGroups.filter((g) => g.groupId !== groupId)
          localStorage.setItem("savedGroups", JSON.stringify(updatedGroups))
        } catch (e) {
          console.error("Error updating localStorage after leaving group", e)
        }

        // Bỏ chọn nhóm nếu đang được chọn
        if (selectedContact?.id === groupId && selectedContact?.type === "group") {
          setSelectedContact(null)
          setMessages([])
          setMediaFiles([])
          setDocuments([])
        }

        setShowGroupInfoModal(false) // Đóng modal
        showError("Bạn đã rời khỏi nhóm thành công")

        // Thông báo qua socket nếu cần
        if (socket.connected) {
          socket.emit("left_group", { groupId })
        }
      } catch (error) {
        console.error("Error leaving group:", error)
        showError("Không thể rời khỏi nhóm: " + error.message)
      } finally {
        setLoading(false)
      }
    },
    [selectedContact, showError, apiCall],
  )

  const handleDeleteGroup = useCallback(
    (groupId) => {
      console.log("Deleting group:", groupId)
      setGroups((prev) => prev.filter((group) => group.groupId !== groupId))
      try {
        const savedGroups = JSON.parse(localStorage.getItem("savedGroups") || "[]")
        const updatedGroups = savedGroups.filter((g) => g.groupId !== groupId)
        localStorage.setItem("savedGroups", JSON.stringify(updatedGroups))
      } catch (e) {
        console.error("Error updating localStorage after deleting group", e)
      }
      if (selectedContact?.id === groupId && selectedContact?.type === "group") {
        setSelectedContact(null)
        setMessages([])
        setMediaFiles([])
        setDocuments([])
      }
      setShowGroupInfoModal(false) // Close modal
      showError("Đã xóa nhóm thành công")
      // API call to delete group should be handled within GroupInfoModal or here before state update
    },
    [selectedContact, showError],
  )

  // --- Effects ---

  // Initial Load: Token Check, User Profile, Contacts, Groups, Socket Init
  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) {
      navigate("/login")
      return
    }

    let isMounted = true // Flag to prevent state updates on unmounted component
    let socketInitialized = false

    const initializeApp = async () => {
      try {
        setLoading(true)
        const userProfile = await fetchUserProfile(token)
        if (!userProfile || !isMounted) return // Stop if fetch failed or component unmounted

        // Fetch contacts and groups after getting user profile
        await fetchContactsAndGroups(token)
        if (!isMounted) return

        // Fetch initial friend requests
        await fetchFriendRequests(token)
        if (!isMounted) return

        // Initialize Socket only once
        if (!socketInitialized && userProfile.userId && !socket.connected) {
          console.log("Initializing socket connection...")
          
          // Set socket auth and query params
          socket.auth = { token }
          socket.io.opts.query = {
            userId: userProfile.userId,
            timestamp: Date.now(),
          }

          // Connect the socket
          socket.connect()
          socketInitialized = true
        }
      } catch (error) {
        console.error("Initialization error:", error)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    initializeApp()

    // Cleanup function
    return () => {
      isMounted = false
      // Don't disconnect socket on component unmount
      // Just remove listeners if needed
      socket.off("connect")
      socket.off("reconnect")
      socket.off("friend_request")
      socket.off("new_message")
      socket.off("receive_message")
      socket.off("group_message")
      socket.off("friend_request_accepted")
      socket.off("friend_removed")
      socket.off("refresh_contacts")
      socket.off("notification")
      socket.off("group_created")
      socket.off("group_updated")
      socket.off("group_deleted")
      socket.off("member_added")
      socket.off("member_removed")
    }
  }, [navigate]) // Only depend on navigate

  // Khi khởi tạo component, đọc cache từ localStorage
  useEffect(() => {
    // ... các logic khác
    const cache = localStorage.getItem('cachedMessages')
    if (cache) {
      setCachedMessages(JSON.parse(cache))
    }
  }, [navigate])

  // Define socket event handlers using useCallback
  const handleNewMessage = useCallback((data) => {
    console.log("Received new message event:", data); // Log toàn bộ dữ liệu tin nhắn nhận được

    if (!data || (!data.messageId && !data.id)) {
      console.error("Invalid message data received:", data)
      return
    }

    const messageTime = data.createdAt
      ? new Date(data.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const messageDate = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : new Date().toLocaleDateString()

    console.log("Current selected contact:", selectedContact); // Log thông tin contact đang được chọn
    console.log("Message data:", {
      groupId: data.groupId,
      conversationId: data.conversationId,
      selectedContactType: selectedContact?.type,
      selectedContactGroupId: selectedContact?.groupId,
      selectedContactConversationId: selectedContact?.conversationId
    });

    const isCurrentChat =
      (selectedContact?.type === "group" && selectedContact.groupId === data.groupId) ||
      (selectedContact?.type === "contact" && selectedContact.conversationId === data.conversationId)

    console.log("Is current chat:", isCurrentChat); // Log kết quả kiểm tra isCurrentChat

      const newMessage = {
        id: data.messageId || data.id,
      sender: data.senderId === user.id ? "Me" : data.senderName || "Người khác",
        content:
          data.isDeleted
            ? "Tin nhắn đã bị xóa"
            : data.isRecalled
              ? "Tin nhắn đã bị thu hồi/xóa"
              : data.type === "text" || data.type === "emoji" || data.type === "system"
                ? data.content
                : data.attachments?.[0]?.url || data.content || "",
        time: messageTime,
        senderId: data.senderId,
        isImage: !data.isDeleted && (data.type === "image" || data.type === "imageGroup"),
        isVideo: !data.isDeleted && data.type === "video",
        isFile: !data.isDeleted && data.type === "file",
      isUnsent: data.isRecalled || data.isDeleted,
        isSystemMessage: data.isSystemMessage || data.senderId === "system",
        fileUrl: !data.isDeleted && data.type === "file" ? data.attachments?.[0]?.url : null,
        fileName: !data.isDeleted && data.type === "file" ? data.attachments?.[0]?.name : null,
        fileType: !data.isDeleted && data.type === "file" ? data.attachments?.[0]?.type : null,
        duration: !data.isDeleted && data.type === "video" ? data.attachments?.[0]?.duration || data.duration : null,
        messageDate: messageDate,
      }

    // LUÔN LUÔN lưu vào cache theo conversationId, kể cả khi không phải chat đang mở
    if (data.conversationId) {
      setCachedMessages(prev => {
        const prevList = prev[data.conversationId] || []
        if (prevList.some(msg => msg.id === newMessage.id)) return prev
        const updated = { ...prev, [data.conversationId]: [...prevList, newMessage] }
        // Lưu vào localStorage
        localStorage.setItem('cachedMessages', JSON.stringify(updated))
        console.log('>>> Updated cachedMessages:', updated)
        return updated
      })
    }

    if (isCurrentChat) {
      setMessages(prev => {
        const exists = prev.some(msg => msg.id === newMessage.id)
        if (exists) return prev
        return [...prev, newMessage]
      })
      // Add to media/documents if it's a file/media
      if ((newMessage.isImage || newMessage.isVideo) && newMessage.content) {
        setMediaFiles((prev) => [
          {
            id: newMessage.id,
            type: newMessage.isImage ? "image" : "video",
            url: newMessage.content,
            name: newMessage.fileName || (newMessage.isImage ? "image.jpg" : "video.mp4"),
            date: newMessage.messageDate,
            size: data.attachments?.[0]?.size || 0,
            duration: newMessage.duration,
          },
          ...prev, // Add to beginning
        ])
      } else if (newMessage.isFile && newMessage.fileUrl) {
        setDocuments((prev) => [
          {
            id: newMessage.id,
            type: newMessage.fileName?.split(".").pop().toLowerCase() || "file",
            url: newMessage.fileUrl,
            name: newMessage.fileName,
            date: newMessage.messageDate,
            size: data.attachments?.[0]?.size || 0,
          },
          ...prev, // Add to beginning
        ])
      }
    } else {
      // Notification for message in other chat
      let senderName = "Người dùng"
      let contactId = data.senderId // Default to senderId for contacts
      let targetId = data.senderId; // Use senderId or groupId to find the item in the list
      let isGroupMessage = !!data.groupId;

      if (isGroupMessage) {
        targetId = data.groupId; // If it's a group message, target the group
        const group = groups.find((g) => g.groupId === data.groupId)
        senderName = `${data.senderName || "Ai đó"} (${group?.name || "Nhóm"})`
      } else {
        const contact = contacts.find((c) => c.id === data.senderId) // Tìm contact dựa trên senderId
        senderName = contact?.name || data.senderName || "Ai đó"
        contactId = data.senderId; // Xác định contactId cho tin nhắn cá nhân
      }

      const preview =
        data.type === "text"
          ? data.content?.substring(0, 30) + (data.content?.length > 30 ? "..." : "")
          : `[${data.type === "image" ? "Hình ảnh" : data.type === "video" ? "Video" : "Tệp"}]`
      showError(`Tin nhắn mới từ ${senderName}: ${preview}`)

      // Cập nhật số tin nhắn chưa đọc và tin nhắn cuối cùng trong danh sách liên hệ/nhóm
      setContacts(prev => prev.map(item => {
        // Tìm item (contact hoặc group) cần cập nhật
        const itemIdToMatch = item.type === 'group' ? item.groupId : item.id;
        if (itemIdToMatch === targetId) {
          console.log(`Updating unread count and last message for ${item.type}: ${item.name || item.id}`);
          // Cập nhật unreadCount và lastMessage
          return {
            ...item,
            unreadCount: (item.unreadCount || 0) + 1,
            lastMessage: {
              content: data.type === "text" ? data.content : preview, // Use full content for text, preview for media/files
              type: data.type,
              senderId: data.senderId,
              createdAt: data.createdAt || new Date().toISOString()
            },
            lastMessageAt: data.createdAt || new Date().toISOString()
          };
        }
        return item;
      }));

      // Update groups list similarly if needed (currently handleNewMessage is for both based on data structure)
      // Potentially refactor to handle contact and group updates separately for clarity if data structures diverge.

      // Nếu chưa có chat nào đang mở, tự động mở chat với người gửi
      if (!selectedContact && data.conversationId) {
        // Tìm contact hoặc group tương ứng
        let foundContact = contacts.find(
          c => c.conversationId === data.conversationId || c.id === data.senderId
        )
        if (foundContact) {
          setSelectedContact(foundContact)
          // Hiển thị luôn tin nhắn cache
          setMessages(cachedMessages[data.conversationId] || [])
        }
      }
    }

    // Browser notification
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const contactName = data.senderName || "Người dùng"
      new Notification(contactName, {
        body: data.type === "text" ? data.content : `Đã gửi một ${data.type}`,
        icon: contacts.find((c) => c.id === data.senderId)?.avatar || groups.find(g => g.groupId === data.groupId)?.avatar || "/favicon.ico", // Optional icon
      })
    }
  }, [user.id, contacts, groups, selectedContact, showError, cachedMessages])

  const handleFriendRequest = useCallback((data) => {
    if (!data || !data.requestId || !data.sender) return
    // ... rest of handleFriendRequest implementation ...
  }, [showError, fetchFriendRequests, setActiveTab])

  const handleFriendRequestAccepted = useCallback((data) => {
    if (!data) {
      console.error("Invalid friend_request_accepted data: null")
      return
    }
    // ... rest of handleFriendRequestAccepted implementation ...
  }, [showError, createOrGetConversation, addOrUpdateContact, user])

  const handleFriendRemoved = useCallback((data) => {
    if (!data || !data.removerId) return
    // ... rest of handleFriendRemoved implementation ...
  }, [contacts, selectedContact, showError])

  const handleRefreshContacts = useCallback(() => {
    const token = localStorage.getItem("token")
    if (token) {
      fetchContactsAndGroups(token)
    }
  }, [fetchContactsAndGroups])

  const handleSocketGroupCreated = useCallback((data) => {
    if (!data?.group) return
    console.log("Received group_created event:", data.group)
    const group = data.group
    const groupObject = {
      groupId: group.groupId,
      id: group.groupId,
      name: group.name,
      avatar: group.avatarUrl || "",
      type: "group",
      adminId: group.adminId,
      memberCount: group.members?.length || 1,
      conversationId: group.conversationId || group.groupId,
      createdAt: group.createdAt,
    }
    addOrUpdateGroup(groupObject)
    showError(`Bạn đã được thêm vào nhóm "${group.name}"`)
  }, [addOrUpdateGroup, showError])

  const handleSocketGroupUpdated = useCallback((data) => {
    if (!data?.group) return
    console.log("Received group_updated event:", data.group)
    const group = data.group
    const groupObject = {
      groupId: group.groupId,
      id: group.groupId,
      name: group.name,
      avatar: group.avatarUrl || "",
      type: "group",
      adminId: group.adminId,
      memberCount: group.memberCount || group.members?.length || 0,
      conversationId: group.conversationId || group.groupId,
      createdAt: group.createdAt,
    }
    addOrUpdateGroup(groupObject)
    if (selectedContact?.id === group.groupId && selectedContact?.type === "group") {
      setSelectedContact(groupObject)
    }
    showError(`Nhóm "${group.name}" đã được cập nhật`)
  }, [addOrUpdateGroup, selectedContact, showError])

  const handleGroupDeleted = useCallback((data) => {
    if (!data?.groupId) return
    console.log("Received group_deleted event:", data.groupId)
    const groupName = groups.find(g => g.groupId === data.groupId)?.name || "Một nhóm"
    setGroups((prev) => prev.filter((group) => group.groupId !== data.groupId))
    try {
      const savedGroups = JSON.parse(localStorage.getItem("savedGroups") || "[]")
      const updatedGroups = savedGroups.filter((g) => g.groupId !== data.groupId)
      localStorage.setItem("savedGroups", JSON.stringify(updatedGroups))
    } catch (e) { console.error("Error updating localStorage after group delete", e) }

    if (selectedContact?.id === data.groupId && selectedContact?.type === "group") {
      setSelectedContact(null)
      setMessages([])
      setMediaFiles([])
      setDocuments([])
    }
    showError(`Nhóm "${groupName}" đã bị xóa`)
  }, [groups, selectedContact, showError])

  const handleMemberAdded = useCallback((data) => {
    if (!data?.group || !data?.member || !data?.addedBy) return
    console.log("Received member_added event:", data)
    const group = data.group
    const groupObject = {
      groupId: group.groupId,
      id: group.groupId,
      name: group.name,
      avatar: group.avatarUrl || "",
      type: "group",
      adminId: group.adminId,
      memberCount: group.memberCount || group.members?.length || 0,
      conversationId: group.conversationId || group.groupId,
      createdAt: group.createdAt,
    }
    addOrUpdateGroup(groupObject)
    if (data.member.userId !== user.id) {
      showError(`${data.addedBy.fullName || 'Admin'} đã thêm ${data.member.fullName || 'thành viên mới'} vào nhóm "${group.name}"`)
    }
    if (selectedContact?.id === group.groupId && selectedContact?.type === "group") {
      setSelectedContact(groupObject)
    }
  }, [user.id, addOrUpdateGroup, selectedContact, showError])

  const handleMemberRemoved = useCallback((data) => {
    if (!data?.group || !data?.memberId || !data?.removedBy) return
    console.log("Received member_removed event:", data)
    const group = data.group
    const groupId = group.groupId

    if (data.memberId === user.id) {
      showError(`Bạn đã bị xóa khỏi nhóm "${group.name}"`)
      setGroups((prev) => prev.filter((g) => g.groupId !== groupId))
      try {
        const savedGroups = JSON.parse(localStorage.getItem("savedGroups") || "[]")
        const updatedGroups = savedGroups.filter((g) => g.groupId !== groupId)
        localStorage.setItem("savedGroups", JSON.stringify(updatedGroups))
      } catch(e) { console.error("Error updating localStorage after being removed from group", e) }
      if (selectedContact?.id === groupId && selectedContact?.type === "group") {
        setSelectedContact(null)
        setMessages([])
        setMediaFiles([])
        setDocuments([])
      }
    } else {
      const groupObject = {
        groupId: group.groupId,
        id: group.groupId,
        name: group.name,
        avatar: group.avatarUrl || "",
        type: "group",
        adminId: group.adminId,
        memberCount: group.memberCount || group.members?.length || 0,
        conversationId: group.conversationId || group.groupId,
        createdAt: group.createdAt,
      }
      addOrUpdateGroup(groupObject)
      const memberName = data.member?.fullName || "một thành viên"
      showError(`${data.removedBy.fullName || 'Admin'} đã xóa ${memberName} khỏi nhóm "${group.name}"`)
      if (selectedContact?.id === group.groupId && selectedContact?.type === "group") {
        setSelectedContact(groupObject)
      }
    }
  }, [user.id, addOrUpdateGroup, selectedContact, showError])

  const handleNotification = useCallback((data) => {
    if (!data || !data.message) {
      console.error("Invalid notification data:", data)
      return
    }
    if (data.type === "success") {
      showError(data.message)
    } else if (data.type === "error") {
      showError(data.message, "error")
    } else if (data.type === "warning") {
      showError(data.message, "warning")
    } else {
      showError(data.message)
    }
    if (data.refreshContacts) {
      const token = localStorage.getItem("token")
      if (token) {
        fetchContactsAndGroups(token)
      }
    }
  }, [showError, fetchContactsAndGroups])

  // Socket Event Listeners Effect
  useEffect(() => {
    let isMounted = true

    const handleConnect = () => {
      if (!isMounted) return
      console.log("Socket re-connected inside hook.")
      setIsConnected(true)
      const userProfile = JSON.parse(localStorage.getItem("userProfile") || "{}")
      if (userProfile.userId) {
        socket.emit("user_connected", userProfile.userId)
      }
    }

    // Add handler for message_sent event
    const handleMessageSent = (data) => {
      if (!data || !data.messageId) {
        console.error("Invalid message_sent_success data:", data)
        return
      }
      console.log("Received message_sent_success event:", data)

      // Update the message status in messages list
      setMessages(prevMessages => prevMessages.map(msg => {
        // Check if this is the message we're looking for
        if (msg.isSending && (
          // Match by tempMessageId if available
          (data.tempMessageId && msg.id === data.tempMessageId) ||
          // Or match by conversationId and content if tempMessageId not available
          (data.conversationId && msg.conversationId === data.conversationId && 
           msg.content === data.content)
        )) {
          console.log("Updating message status:", {
            oldId: msg.id,
            newId: data.messageId,
            content: msg.content
          })
          return {
            ...msg,
            id: data.messageId,
            messageId: data.messageId,
            isSending: false,
            createdAt: data.createdAt || msg.createdAt
          }
        }
        return msg
      }))
    }

    // Add socket listeners only if socket is connected
    socket.on("connect", handleConnect)
    socket.on("message_sent_success", handleMessageSent) // Listen for message confirmation
    socket.on("new_message", handleNewMessage)
    socket.on("receive_message", handleNewMessage)
    socket.on("group_message", handleNewMessage)
    socket.on("friend_request", handleFriendRequest)
    socket.on("friend_request_accepted", handleFriendRequestAccepted)
    socket.on("friend_removed", handleFriendRemoved)
    socket.on("refresh_contacts", handleRefreshContacts)
    socket.on("notification", handleNotification)
    socket.on("group_created", handleSocketGroupCreated)
    socket.on("group_updated", handleSocketGroupUpdated)
    socket.on("group_deleted", handleGroupDeleted)
    socket.on("member_added", handleMemberAdded)
    socket.on("member_removed", handleMemberRemoved)

    // Cleanup listeners on unmount or dependency change
    return () => {
      isMounted = false
      socket.off("connect", handleConnect)
      socket.off("message_sent_success", handleMessageSent) // Remove message_sent handler
      socket.off("new_message", handleNewMessage)
      socket.off("receive_message", handleNewMessage)
      socket.off("group_message", handleNewMessage)
      socket.off("friend_request", handleFriendRequest)
      socket.off("friend_request_accepted", handleFriendRequestAccepted)
      socket.off("friend_removed", handleFriendRemoved)
      socket.off("refresh_contacts", handleRefreshContacts)
      socket.off("notification", handleNotification)
      socket.off("group_created", handleSocketGroupCreated)
      socket.off("group_updated", handleSocketGroupUpdated)
      socket.off("group_deleted", handleGroupDeleted)
      socket.off("member_added", handleMemberAdded)
      socket.off("member_removed", handleMemberRemoved)
    }
  }, [
    handleNewMessage,
    handleFriendRequest,
    handleFriendRequestAccepted,
    handleFriendRemoved,
    handleRefreshContacts,
    handleNotification,
    handleSocketGroupCreated,
    handleSocketGroupUpdated,
    handleGroupDeleted,
    handleMemberAdded,
    handleMemberRemoved,
    selectedContact // Add selectedContact as dependency
  ])

  // Scroll to bottom effect
  useEffect(() => {
    scrollToBottom()
  }, [messages]) // Run whenever messages array changes

  // Function to scroll messages
  const scrollToBottom = () => {
    // Add a slight delay to allow the DOM to update after new message added
    setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 100);
  }

  // ... existing code ...
  useEffect(() => {
    // ... các event khác ...
    const handleMessageDeleted = (data) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, content: "Tin nhắn đã bị xóa", isUnsent: true }
            : msg
        )
      )
    }
    socket.on("message_deleted", handleMessageDeleted)
    // ... cleanup ...
    return () => {
      socket.off("message_deleted", handleMessageDeleted)
      // ... cleanup các event khác ...
    }
  }, [setMessages])
  // ... existing code ...

  // --- Derived State ---
  const filteredContacts = contacts.filter(
    (contact) => contact.type === "contact" && contact.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )
  const filteredGroups = groups.filter(
    (group) => group.type === "group" && group.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const emojis = ["😊", "😂", "❤️", "👍", "🎉", "🔥", "😎", "🙏", "💯", "🤔"] // Keep emojis here or move to constants

  // --- Return Values ---
  return {
    // State
    user,
    contacts, // Return full contacts list if needed elsewhere
    groups,   // Return full groups list if needed elsewhere
    selectedContact,
    messages,
    newMessage,
    isConnected,
    showEmojiPicker,
    searchQuery,
    mediaFiles,
    documents,
    showMedia,
    showFiles,
    activeTab,
    showProfileModal,
    profileData,
    loading,
    showAddFriendModal,
    friendEmail,
    error,
    showToast,
    friendRequests,
    showCreateGroupModal,
    showGroupInfoModal,
    selectedGroup,

    // Setters (Only expose necessary setters)
    setNewMessage,
    setShowEmojiPicker,
    setSearchQuery,
    // setShowMedia, // Handled by toggle functions
    // setShowFiles, // Handled by toggle functions
    setActiveTab, // Needed for friend request notification
    setShowProfileModal, // Needed for closing modal from component
    setProfileData, // Needed for form inputs
    // setLoading, // Internal state
    setShowAddFriendModal, // Needed for closing modal from component
    setFriendEmail, // Needed for form input
    // setError, // Internal state
    setShowToast, // Needed for closing toast from component
    // setFriendRequests, // Internal state
    setShowCreateGroupModal, // Needed for closing modal from component
    setShowGroupInfoModal, // Needed for closing modal from component
    // setSelectedGroup, // Handled by handleGroupInfo

    // Refs
    messagesEndRef,
    fileInputRef,
    imageInputRef,
    videoInputRef,

    // Handlers
    handleContactSelect,
    handleSendMessage,
    handleSendFile, // Consolidated file sending
    handleEmojiSelect,
    handleMessageAction,
    toggleMediaView,
    toggleFilesView,
    handleTabChange,
    handleProfileClick,
    handleCloseProfileModal,
    handleAvatarChange,
    handleUpdateProfile,
    handleAddFriend,
    handleCloseAddFriendModal,
    handleSubmitAddFriend,
    handleRespondToFriendRequest,
    handleRemoveFriend,
    handleCreateGroup,
    handleGroupCreated,
    handleGroupInfo,
    handleGroupUpdated,
    handleLeaveGroup,
    handleDeleteGroup,
    showError, // Expose showError if needed externally

    // Derived Data
    filteredContacts,
    filteredGroups,
    emojis,
    token: localStorage.getItem("token"), // Pass token for Modals
  }
}

export default useChat
